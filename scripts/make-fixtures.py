"""
Generates the test PDFs the harnesses and the run skill expect.

    python scripts/make-fixtures.py <out-dir>

Produces:
  sample.pdf  60 pages, a bookmark outline, and a unique marker per page
              ("zebra-001-quartz" ...) so search results can be asserted exactly.
              Page 1 carries an internal link to page 31 and an external one.
  cjk.pdf     a page of CJK text, to prove the pdf.js cmaps / standard_fonts
              assets were copied into the renderer bundle.

Requires reportlab (`pip install reportlab`).
"""

import sys
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas

BODY = (
    "The quick brown fox jumps over the lazy dog. Highlighting text in a PDF "
    "requires mapping selection rectangles back into PDF user space. This sample "
    "document exists to exercise rendering, selection, search and outline "
    "navigation in the reader application. "
)

PAGES = 60
# The harnesses in scripts/ assert on this exact shape (e.g. "zebra-042-quartz"),
# so the prefix and suffix are fixed and only the page number varies.
MARKER = "zebra-{page:03d}-quartz"

# Page 1's links, below the marker; kept identical to make-fixtures.mjs, which
# scripts/smoke.mjs asserts against. The internal one uses a named destination.
LINK_TARGET = "link-target"
LINK_TARGET_PAGE = 31
LINK_TARGET_TOP = 500
INTERNAL_LINK = (120, "Internal link: go to page 31")
EXTERNAL_LINK = (100, "External link: visit example.com")
EXTERNAL_URL = "https://example.com/"


def link_rect(y):
    return (70, y - 3, 250, y + 12)


def wrap(text, width):
    words, line, out = text.split(), "", []
    for w in words:
        trial = f"{line} {w}".strip()
        if len(trial) > width:
            out.append(line)
            line = w
        else:
            line = trial
    if line:
        out.append(line)
    return out


def sample(path: Path) -> None:
    c = canvas.Canvas(str(path), pagesize=A4)
    c.setTitle("Sample Technical Manual")
    c.setAuthor("Fixture Generator")
    width, height = A4

    for page in range(1, PAGES + 1):
        section = (page - 1) // 10 + 1
        c.setFont("Helvetica-Bold", 16)
        c.drawString(72, height - 72, f"Chapter {section} - Section {(page - 1) % 10 + 1}")

        c.setFont("Helvetica", 11)
        y = height - 110
        for line in wrap(BODY * 3, 92):
            if y < 140:
                break
            c.drawString(72, y, line)
            y -= 15

        # A string that appears exactly once in the whole document.
        marker = MARKER.format(page=page)
        c.setFont("Helvetica", 11)
        c.drawString(72, y - 20, f"Distinctive marker for page {page}: {marker}.")

        if page == 1:
            for link_y, text in (INTERNAL_LINK, EXTERNAL_LINK):
                c.drawString(72, link_y, text)
            # The destination is defined on page 31; reportlab resolves it at save.
            c.linkRect("", LINK_TARGET, link_rect(INTERNAL_LINK[0]), relative=0, thickness=0)
            c.linkURL(EXTERNAL_URL, link_rect(EXTERNAL_LINK[0]), relative=0, thickness=0)
        if page == LINK_TARGET_PAGE:
            c.bookmarkPage(LINK_TARGET, fit="XYZ", left=0, top=LINK_TARGET_TOP)

        c.bookmarkPage(f"p{page}")
        if page % 10 == 1:
            c.addOutlineEntry(f"Chapter {section}", f"p{page}", level=0)
        # One entry per page, numbered by page: scripts/smoke.mjs navigates to the
        # row titled "Section 31" and asserts it lands on page 31.
        c.addOutlineEntry(f"Section {page}", f"p{page}", level=1)

        c.showPage()

    c.showOutline()
    c.save()
    print(f"wrote {path} ({PAGES} pages)")


def cjk(path: Path) -> None:
    pdfmetrics.registerFont(UnicodeCIDFont("HeiseiKakuGo-W5"))
    c = canvas.Canvas(str(path), pagesize=A4)
    c.setTitle("CJK Sample")
    width, height = A4
    c.setFont("HeiseiKakuGo-W5", 18)
    c.drawString(72, height - 100, "日本語のテキストサンプル")
    c.setFont("HeiseiKakuGo-W5", 12)
    for i, line in enumerate(
        [
            "これはPDFリーダーのテスト用ドキュメントです。",
            "ハイライトとノートの機能を確認します。",
            "検索機能もテストしています。",
        ]
    ):
        c.drawString(72, height - 140 - i * 24, line)
    c.showPage()
    c.save()
    print(f"wrote {path}")


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "fixtures")
    out.mkdir(parents=True, exist_ok=True)
    sample(out / "sample.pdf")
    cjk(out / "cjk.pdf")
