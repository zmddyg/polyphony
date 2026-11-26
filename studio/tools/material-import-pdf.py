"""Read local PDF pages and rasterize their original appearance without browser actions."""

import base64
import json
import math
import sys


def read_pdf(path, page_limit, text_limit, preview_limit):
    try:
        import pymupdf
    except ImportError:
        try:
            import fitz as pymupdf
        except ImportError:
            return {"error": "unavailable"}

    pymupdf.TOOLS.mupdf_display_errors(False)
    pymupdf.TOOLS.mupdf_display_warnings(False)
    try:
        document = pymupdf.open(path, filetype="pdf")
    except (RuntimeError, ValueError):
        return {"error": "invalid"}

    pages = []
    truncated = False
    missing_text = False
    missing_previews = False
    with document:
        if document.needs_pass:
            return {"error": "password"}
        if document.page_count > page_limit:
            return {"error": "page-limit"}

        # Share the image budget across all pages so a large scan cannot starve later pages.
        per_page_budget = preview_limit // max(1, document.page_count)
        for number in range(1, document.page_count + 1):
            page = document.load_page(number - 1)
            try:
                text = page.get_text("text", sort=True).strip()
            except (RuntimeError, ValueError):
                text = ""
            text = text.replace("\x00", "").strip()
            missing_text = missing_text or not text
            truncated = truncated or len(text) > text_limit
            title = " ".join(text.split("\n", 1)[0].split())[:120]
            entry = {
                "number": number,
                "title": title or f"\u7b2c {number} \u9875",
                "text": text[:text_limit],
            }
            try:
                preview = render_preview(pymupdf, page, per_page_budget)
            except (RuntimeError, ValueError, OverflowError):
                preview = None
            if preview is None:
                missing_previews = True
            else:
                entry["preview"] = "data:image/png;base64," + base64.b64encode(preview).decode("ascii")
            pages.append(entry)

    return {
        "pages": pages,
        "truncated": truncated,
        "missingPreviews": missing_previews,
        "missingText": missing_text,
    }


def render_preview(pymupdf, page, budget):
    dimension = max(page.rect.width, page.rect.height)
    if not math.isfinite(dimension) or dimension <= 0:
        return None
    display_list = page.get_displaylist(annots=True)
    for pixels in (1200, 900, 650, 420, 280, 200):
        scale = pixels / dimension
        matrix = pymupdf.Matrix(scale, scale)
        # A raster image does not preserve PDF links, form actions, or attachments.
        image = display_list.get_pixmap(matrix=matrix, colorspace=pymupdf.csRGB, alpha=False).tobytes("png")
        if len(image) <= budget:
            return image
    return None


if __name__ == "__main__":
    if sys.platform.startswith("linux"):
        import resource

        budget = 640 * 1024 * 1024
        _, hard = resource.getrlimit(resource.RLIMIT_AS)
        ceiling = budget if hard == resource.RLIM_INFINITY else min(budget, hard)
        resource.setrlimit(resource.RLIMIT_AS, (ceiling, ceiling))
    path, page_limit, text_limit, preview_limit = sys.argv[1:]
    result = read_pdf(path, int(page_limit), int(text_limit), int(preview_limit))
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    json.dump(result, sys.stdout, ensure_ascii=False)
