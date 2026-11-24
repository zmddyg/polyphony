"""Render an isolated presentation using the LibreOffice UNO media descriptor."""

from contextlib import suppress
import json
from pathlib import Path
import posixpath
import subprocess
import sys
import time
import traceback
from urllib.parse import unquote, urlsplit
import uuid
import xml.etree.ElementTree as ET
from xml.parsers import expat
import zipfile


PRESENTATION_SERVICE = "com.sun.star.presentation.PresentationDocument"
FILTERS = {".ppt": "MS PowerPoint 97", ".pptx": "Impress MS PowerPoint 2007 XML"}
PROFILE = """<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry">
  <item oor:path="/org.openoffice.Office.Common/Security/Scripting">
    <prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop>
    <prop oor:name="DisableActiveContent" oor:op="fuse"><value>true</value></prop>
    <prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop>
  </item>
</oor:items>
"""


def read_xml_bytes(package, name):
    entry = package.getinfo(name)
    if entry.file_size > 4 * 1024 * 1024:
        raise ValueError("Presentation metadata is too large")
    xml = package.read(entry)
    if b"<!DOCTYPE" in xml.replace(b"\x00", b"").upper():
        raise ValueError("Unexpected XML document type")
    return xml


def is_hidden_slide(xml, expected_tag):
    hidden = False
    parser = expat.ParserCreate(namespace_separator="}")

    def read_root(tag, attributes):
        nonlocal hidden
        if tag != expected_tag:
            raise ValueError("Unexpected slide namespace")
        hidden = attributes.get("show") in ("false", "0")
        parser.StartElementHandler = None

    # Validate the entire part while retaining only the root visibility attribute.
    parser.StartElementHandler = read_root
    parser.Parse(xml, True)
    return hidden


def pptx_slide_metadata(source, page_limit):
    # Check the source slide order and visibility independently of the exported PDF.
    with zipfile.ZipFile(source) as package:
        entries = package.infolist()
        if len(entries) > 20_000 or sum(entry.file_size for entry in entries) > 256 * 1024 * 1024:
            raise ValueError("Presentation package is too large")
        presentation = ET.fromstring(read_xml_bytes(package, "ppt/presentation.xml"))
        namespace = presentation.tag.partition("}")[0][1:]
        prefixes = {
            "http://schemas.openxmlformats.org/presentationml/2006/main":
                "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}",
            "http://purl.oclc.org/ooxml/presentationml/main":
                "{http://purl.oclc.org/ooxml/officeDocument/relationships}",
        }
        if namespace not in prefixes:
            raise ValueError("Unrecognized presentation namespace")
        prefix = "{" + namespace + "}"
        slides = presentation.find(prefix + "sldIdLst")
        rows = [] if slides is None else slides.findall(prefix + "sldId")
        if not rows or len(rows) > page_limit:
            return len(rows), []
        relationships = ET.fromstring(read_xml_bytes(package, "ppt/_rels/presentation.xml.rels"))
        targets = {
            row.get("Id"): row.get("Target")
            for row in relationships
            if row.get("Type", "").endswith("/slide") and row.get("TargetMode") != "External"
        }
        hidden = []
        for number, row in enumerate(rows, 1):
            target = urlsplit(targets[row.get(prefixes[namespace] + "id")])
            path = unquote(target.path)
            if target.scheme or target.netloc or target.query or target.fragment or "\\" in path:
                raise ValueError("Invalid slide target")
            part = posixpath.normpath(path.lstrip("/") if path.startswith("/") else "ppt/" + path)
            if is_hidden_slide(read_xml_bytes(package, part), namespace + "}sld"):
                hidden.append(number)
        return len(rows), hidden


def office_desktop(uno, process, pipe):
    from com.sun.star.connection import NoConnectException

    context = uno.getComponentContext()
    resolver = context.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", context)
    deadline = time.monotonic() + 8
    while process.poll() is None and time.monotonic() < deadline:
        try:
            remote = resolver.resolve(f"uno:{pipe};urp;StarOffice.ComponentContext")
            return remote.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", remote)
        except NoConnectException:
            time.sleep(0.1)
    raise RuntimeError("LibreOffice did not open its local UNO pipe")


def stop_office(process):
    if process.poll() is not None:
        return
    with suppress(ProcessLookupError):
        process.terminate()
    try:
        process.wait(2)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def convert(soffice, source, output, page_limit, expected, file_limit, expected_hidden):
    import uno
    from com.sun.star.beans import PropertyValue
    from com.sun.star.beans.PropertyState import DIRECT_VALUE

    if source.suffix == ".pptx":
        expected, expected_hidden = pptx_slide_metadata(source, page_limit)
        if not expected:
            return {"error": "invalid"}
    if expected > page_limit:
        return {"error": "page-limit"}

    if sys.platform.startswith("linux"):
        import resource

        for kind, budget in ((resource.RLIMIT_FSIZE, file_limit), (resource.RLIMIT_AS, 1536 * 1024 * 1024)):
            _, hard = resource.getrlimit(kind)
            ceiling = budget if hard == resource.RLIM_INFINITY else min(budget, hard)
            resource.setrlimit(kind, (ceiling, ceiling))

    profile = source.parent / "office-profile"
    user_profile = profile / "user"
    user_profile.mkdir(parents=True)
    (user_profile / "registrymodifications.xcu").write_text(PROFILE, encoding="utf-8")
    pipe = "pipe,name=polyphony_material_" + uuid.uuid4().hex
    process = subprocess.Popen(
        [
            soffice,
            f"-env:UserInstallation={profile.as_uri()}",
            "--headless",
            "--nologo",
            "--nodefault",
            "--norestore",
            f"--accept={pipe};urp;StarOffice.ServiceManager",
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    def prop(name, value):
        return PropertyValue(name, 0, value, DIRECT_VALUE)

    desktop = None
    document = None
    try:
        desktop = office_desktop(uno, process, pipe)
        # The profile also blocks macros and untrusted links before the document is loaded.
        # https://api.libreoffice.org/docs/idl/ref/servicecom_1_1sun_1_1star_1_1document_1_1MediaDescriptor.html
        document = desktop.loadComponentFromURL(source.as_uri(), "_blank", 0, (
            prop("DocumentService", PRESENTATION_SERVICE),
            prop("FilterName", FILTERS[source.suffix]),
            prop("Hidden", True),
            prop("ReadOnly", True),
            prop("Silent", True),
            prop("MacroExecutionMode", uno.Any("short", 0)),  # NEVER_EXECUTE
            prop("UpdateDocMode", uno.Any("short", 0)),  # NO_UPDATE
        ))
        if document is None or not document.supportsService(PRESENTATION_SERVICE):
            return {"error": "invalid"}
        draw_pages = document.getDrawPages()
        page_count = draw_pages.getCount()
        if page_count > page_limit:
            return {"error": "page-limit"}
        if not page_count or (expected and expected != page_count):
            return {"error": "page-mismatch"}
        hidden = [index + 1 for index in range(page_count)
                  if not draw_pages.getByIndex(index).getPropertyValue("Visible")]
        if expected_hidden is not None and hidden != expected_hidden:
            return {"error": "page-mismatch"}
        filters = uno.Any("[]com.sun.star.beans.PropertyValue", (
            prop("ExportHiddenSlides", True),
            prop("ExportFormFields", False),
            prop("UseTransitionEffects", False),
        ))
        document.storeToURL(output.as_uri(), (
            prop("FilterName", "impress_pdf_Export"),
            prop("FilterData", filters),
        ))
        if not output.is_file() or not 0 < output.stat().st_size <= file_limit:
            return {"error": "output"}
        return {"pageCount": page_count, "hidden": hidden}
    finally:
        if document is not None:
            with suppress(Exception):
                document.dispose()
        if desktop is not None:
            with suppress(Exception):
                desktop.terminate()
        stop_office(process)


if __name__ == "__main__":
    office, source, output, page_limit, expected, file_limit, hidden = sys.argv[1:]
    try:
        result = convert(office, Path(source), Path(output), int(page_limit), int(expected), int(file_limit), json.loads(hidden))
    except Exception:
        traceback.print_exc()
        result = {"error": "conversion"}
    print(json.dumps(result))
