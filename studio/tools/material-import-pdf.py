"""Read local PDF pages and rasterize their original appearance without browser actions."""

import base64
import json
import math
import re
import sys
from contextlib import redirect_stdout
from io import StringIO


def read_pdf(path, page_limit, text_limit, preview_limit, source_image_limit):
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
        figure_budget = source_image_limit // max(1, document.page_count)
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
                entry["preview"] = embedded(preview, "png")
            images = extract_figures(pymupdf, document, page, number, figure_budget)
            if images:
                entry["images"] = images
            blocks = extract_source_blocks(page, text[:text_limit])
            if blocks:
                entry["sourceBlocks"] = blocks
            pages.append(entry)

    return {
        "pages": pages,
        "truncated": truncated,
        "missingPreviews": missing_previews,
        "missingText": missing_text,
    }


def embedded(data, kind):
    return "data:image/" + kind + ";base64," + base64.b64encode(data).decode("ascii")


def extract_figures(pymupdf, document, page, number, budget):
    accepted = {"png": "png", "jpeg": "jpeg", "jpg": "jpeg", "gif": "gif", "webp": "webp", "bmp": "bmp"}
    figures, seen = [], set()
    if budget < 256:
        return figures
    try:
        images = page.get_images(full=True)
    except (RuntimeError, ValueError):
        return figures
    for xref, alpha, width, height, *_ in images[:64]:
        if xref in seen or min(width, height) < 32 or width * height > 8_000_000:
            continue
        seen.add(xref)
        try:
            if alpha:
                mask_size = tuple(document.xref_get_key(alpha, axis) for axis in ("Width", "Height"))
                if mask_size != (("int", str(width)), ("int", str(height))):
                    continue
                pixmap = pymupdf.Pixmap(document, xref)
                if pixmap.alpha:
                    pixmap = pymupdf.Pixmap(pixmap, 0)
                mask = pymupdf.Pixmap(document, alpha)
                if (mask.width, mask.height) != (width, height):
                    continue
                data, kind = pymupdf.Pixmap(pixmap, mask).tobytes("png"), "png"
            else:
                info = document.extract_image(xref) or {}
                data, kind = info.get("image"), accepted.get(info.get("ext"))
        except (RuntimeError, ValueError, OverflowError):
            continue
        if not kind or not data or len(data) > budget:
            continue
        budget -= len(data)
        figures.append({"src": embedded(data, kind), "alt": f"原稿第 {number} 页插图 {len(figures) + 1}"})
        if len(figures) == 6 or budget < 256:
            break
    return figures


def table_paths(page):
    horizontal, vertical, paths = set(), set(), []
    for path in page.get_drawings():
        if path.get("type") not in ("s", "fs"):
            continue
        has_rule = False
        for item in path["items"]:
            if item[0] == "re" and item[1].width >= 14 and item[1].height >= 10:
                rect = item[1]
                horizontal.update((round(rect.y0), round(rect.y1)))
                vertical.update((round(rect.x0), round(rect.x1)))
                has_rule = True
            elif item[0] == "l":
                _, start, end = item
                if abs(start.y - end.y) < 0.8 and abs(start.x - end.x) >= 14:
                    horizontal.add(round(start.y))
                    has_rule = True
                elif abs(start.x - end.x) < 0.8 and abs(start.y - end.y) >= 10:
                    vertical.add(round(start.x))
                    has_rule = True
        if has_rule:
            paths.append(path)
    if 3 <= len(horizontal) <= 140 and 3 <= len(vertical) <= 140 and len(paths) <= 600:
        return paths
    return []


def ruled_tables(page, paths):
    try:
        return page.find_tables(strategy="lines_strict", paths=paths, use_layout=False).tables
    except TypeError:
        return page.find_tables(strategy="lines_strict", paths=paths).tables


def extract_source_blocks(page, text):
    blocks = []
    remaining = 12_000
    try:
        # The renderer uses the original PDF preview. Tables are additional material for rebuilding.
        paths = table_paths(page) if '\n' in text else []
        with redirect_stdout(StringIO()):
            tables = ruled_tables(page, paths)[:6] if paths else []
            for table in tables:
                if not 2 <= table.col_count <= 8 or not 2 <= table.row_count <= 41:
                    continue
                rows = [[" ".join((cell or "").split()) for cell in row] for row in table.extract()]
                if any(len(row) != table.col_count or any(len(cell) > 240 for cell in row) for row in rows):
                    continue
                length = sum(len(cell) for row in rows for cell in row)
                if length <= remaining and rows and any(rows[0]) and any(any(row) for row in rows[1:]):
                    blocks.append({"type": "table", "title": "原稿表格", "headers": rows[0], "rows": rows[1:]})
                    remaining -= length
    except (AttributeError, TypeError, ValueError, RuntimeError, OverflowError):
        pass
    formulas = [line.strip() for line in text.splitlines() if 3 <= len(line.strip()) <= 180 and
                re.fullmatch(r"[A-Za-zα-ωΑ-Ω∂Δ][\w()₀-₉′' /]*\s*[=≈≤≥]\s*[\wα-ωΑ-Ω∫∑∂∆√πℏ∞().,+−*/^\-=≈≤≥×÷^{}₀-₉⁰-⁹\s]+", line.strip()) and
                not re.search(r"[^\W\d_]{5,}\s+[^\W\d_]{4,}", line)]
    if formulas:
        blocks.append({"type": "formula", "title": "原稿算式", "items": list(dict.fromkeys(formulas))[:12]})
    return blocks


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
    path, page_limit, text_limit, preview_limit, *figure_limits = sys.argv[1:]
    result = read_pdf(path, int(page_limit), int(text_limit), int(preview_limit), int(figure_limits[0]) if figure_limits else 0)
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    json.dump(result, sys.stdout, ensure_ascii=False)
