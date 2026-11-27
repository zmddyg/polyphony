"""Audit source, HTML, and competition document text for retired vocabulary."""

import argparse
from base64 import b64decode
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import unquote
from xml.etree import ElementTree
from zipfile import ZipFile


PERMITTED = ('Harness', 'Agent', 'Chat Completions', 'OpenAI')
FORBIDDEN = (
    '\u8bfe\u8c31', '\u603b\u8c31', '\u6392\u7ec3', '\u0050laylab',
    'Polyphony\u0020Studio', 'Score\u0050ackage', 'Type\u0053afe', '\u004aev',
    '\u53f2\u6599', '\u591c\u6821', '\u6570\u5b57\u9ed1\u7bb1',
    '\u57ce\u5e02\u91cc\u54ea\u91cc\u66f4\u51c9\u5feb', '\u5149\u7535\u63a2\u7a76\u53f0',
    '\u786e定性物理数值引擎 (核心防线)',
)
TEXT_EXTENSIONS = {
    '.cmd', '.css', '.example', '.html', '.js', '.json', '.md', '.mjs', '.ps1',
    '.py', '.sh', '.svg', '.txt', '.xml', '.yaml', '.yml',
}
DOCUMENT_EXTENSIONS = {'.pdf', '.pptx'}
GENERATED_DIRS = {'artifacts', 'node_modules', '__pycache__', '.git', '.cache', '.openai', '.pytest_cache'}
TEXT_TERMS = re.compile('|'.join(map(re.escape, FORBIDDEN)), re.IGNORECASE)
CHINESE_STRINGS = re.compile(r"""(['"\x60])[^'"\x60\n]*[\u3400-\u9fff][^'"\x60\n]*\1""")
PRESENTATION_XML = re.compile(r'ppt/(?:slides|notesSlides|slideLayouts|slideMasters)/[^/]+\.xml$')
OFFLINE_IMPORT_MAP = re.compile(r'<script type="importmap">([^<]+)</script>')
OFFLINE_MODULE_PREFIX = 'data:text/javascript;charset=utf-8;base64,'


def is_source_file(path, source_only):
    return not path.is_symlink() and (
        path.name == 'Dockerfile' or path.suffix.lower() in TEXT_EXTENSIONS
        or not source_only and path.suffix.lower() in DOCUMENT_EXTENSIONS
    )


def sources(root, source_only):
    source = root.parent
    for directory, dirs, names in os.walk(source):
        folder = Path(directory)
        dirs[:] = sorted(name for name in dirs if name not in GENERATED_DIRS
                         and not (folder == root / 'dist' and name == 'vendor')
                         and not name.startswith('.polyphony-rooms')
                         and not (folder / name).is_symlink()
                         and not getattr(folder / name, 'is_junction', lambda: False)())
        for name in sorted(names):
            path = folder / name
            if is_source_file(path, source_only):
                yield path
    if source.name == 'source' and source.parent.name == '.polyphony-work':
        generator = source.parent / 'build-competition-docs.py'
        if generator.is_file():
            yield generator
        delivery = source.parents[1]
        for folder in (delivery, delivery / '示例课件'):
            for path in sorted(folder.iterdir()) if folder.is_dir() else ():
                if path.is_file() and is_source_file(path, source_only):
                    yield path


def pdf_text(path):
    try:
        import pymupdf
    except ModuleNotFoundError:
        import fitz as pymupdf
    with pymupdf.open(path) as document:
        for page in document:
            yield f'page {page.number + 1}', page.get_text()


def slide_text(path):
    with ZipFile(path) as deck:
        for member in sorted(deck.namelist()):
            if not PRESENTATION_XML.fullmatch(member):
                continue
            root = ElementTree.fromstring(deck.read(member))
            parts = (''.join(''.join(run.itertext()) for run in paragraph.iter('{*}t'))
                     for paragraph in root.iter('{*}p'))
            yield member, '\n'.join(parts)


def offline_modules(html):
    match = OFFLINE_IMPORT_MAP.search(html)
    if not match:
        return
    for name, data_url in json.loads(match[1]).get('imports', {}).items():
        if (name.startswith('@polyphony/') and not name.startswith('@polyphony/vendor/')
                and data_url.startswith(OFFLINE_MODULE_PREFIX)):
            packed = unquote(data_url.removeprefix(OFFLINE_MODULE_PREFIX))
            yield name, b64decode(packed, validate=True).decode('utf-8')


def audit(root, *, source_only=False):
    counts = dict.fromkeys(FORBIDDEN, 0)
    names = {term.casefold(): term for term in FORBIDDEN}
    hits = []
    scanned = chinese_strings = pdf_pages = slide_parts = 0

    def check(text, path, section=None):
        for number, line in enumerate(text.splitlines(), 1):
            for match in TEXT_TERMS.finditer(line):
                term = names[match.group().casefold()]
                counts[term] += 1
                hits.append({'file': path, 'section': section, 'line': number, 'term': term})

    for path in sources(root, source_only):
        name = Path(os.path.relpath(path, root.parent)).as_posix()
        extension = path.suffix.lower()
        scanned += 1
        if extension == '.pdf':
            for section, text in pdf_text(path):
                pdf_pages += 1
                check(text, name, section)
        elif extension == '.pptx':
            for section, text in slide_text(path):
                slide_parts += 1
                check(text, name, section)
        else:
            text = path.read_text(encoding='utf-8-sig')
            chinese_strings += len(CHINESE_STRINGS.findall(text))
            check(text, name)
            if extension == '.html':
                for section, module in offline_modules(text):
                    check(module, name, section)
    return {
        'files_scanned': scanned, 'pdf_pages_scanned': pdf_pages, 'pptx_parts_scanned': slide_parts,
        'chinese_string_fragments': chinese_strings, 'visible_hits': sum(counts.values()),
        'counts': counts, 'hits': hits,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--json', type=Path)
    parser.add_argument('--source-only', action='store_true', help='Run the text source gate without build-time PDF tooling.')
    options = parser.parse_args()
    result = audit(Path(__file__).resolve().parents[1], source_only=options.source_only)
    output = json.dumps(result, ensure_ascii=False, indent=2)
    if options.json:
        options.json.parent.mkdir(parents=True, exist_ok=True)
        options.json.write_text(output + '\n', encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    print(output)
    raise SystemExit(bool(result['visible_hits']))
