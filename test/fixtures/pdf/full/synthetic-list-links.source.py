# SPDX-License-Identifier: CC0-1.0
from pathlib import Path

from reportlab import rl_config
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph


rl_config.useA85 = 0
output = Path(__file__).with_name("synthetic-list-links.pdf")
canvas = Canvas(str(output), pagesize=(612, 792), invariant=1, pageCompression=1)
canvas.setTitle("Links within synthetic reference items")
canvas.setAuthor("Zotero document-worker contributors")
canvas.setSubject("CC0-1.0 synthetic regression fixture")
canvas.setFont("Times-Bold", 14)
canvas.drawString(54, 735, "Synthetic reference links")
canvas.setFont("Times-Roman", 10)
canvas.drawString(54, 710, "The invented sources [1-6] illustrate independent reference items. Compare (2).")
canvas.drawString(54, 690, "A paragraph link remains intact: https://example.org/paragraph.")
text = "The reported volume and issue are 15(3). Results from 2020(1–3) are linked."
canvas.drawString(54, 670, text)
link_x = 54 + canvas.stringWidth(text[:text.index("(1") + 1], "Times-Roman", 10)
canvas.linkRect("", "source-one", (link_x, 667.5, link_x + 5, 677.5), relative=0, thickness=0)
canvas.setFont("Times-Bold", 12)
canvas.drawString(54, 638, "References")

style = ParagraphStyle(
    "reference", fontName="Times-Roman", fontSize=10, leading=13,
    leftIndent=18, firstLineIndent=-18, spaceAfter=10,
)
items = [
    "1. A. Arbor (2020). Synthetic channel measurements. https://example.org/first",
    "2. B. Birch (2021). Constructed boundary results. doi:10.1234/invented",
    "3. C. Cedar (2022). Authored destination. "
    '<link href="https://example.org/canonical">https://example.org/display</link>',
    "4. D. Dogwood (2023). A styled link. https://example.org/<i>styled</i>",
    "5. E. Elm (2024). A URL followed by ordinary prose. "
    "https://example.org/inside is the location of this invented work.",
    "6. F. Fir (2025). A final source without an external identifier.",
]
y = 617
canvas.bookmarkHorizontalAbsolute("source-one", y - 8, 54)
for text in items:
    paragraph = Paragraph(text, style)
    _, height = paragraph.wrap(490, 792)
    paragraph.drawOn(canvas, 54, y - height)
    y -= height + style.spaceAfter
canvas.showPage()
canvas.setFont("Times-Bold", 14)
canvas.drawString(54, 735, "Author references")
canvas.setFont("Times-Roman", 10)
for y, text in [
    (710, "O’Neill (2020) establishes the first result; O‘Neill (2020) describes the same work."),
    (690, "ONeill (2020) names a different author. D’Arcy (2021) is ambiguous."),
]:
    canvas.drawString(54, y, text)
canvas.setFont("Times-Bold", 12)
canvas.drawString(54, 615, "References")
y = 594
for text in [
    "O'Neill, J. (2020). Invented measurements. Journal of Examples, 4, 11-18.",
    "ONeill, K. (2020). Distinct measurements. Journal of Examples, 4, 27-32.",
    "D'Arcy, J. (2021). Constructed extensions. Journal of Examples, 5, 19-26.",
    "D’Arcy, K. (2021). Synthetic comparisons. Example Press.",
]:
    paragraph = Paragraph(text, style)
    _, height = paragraph.wrap(490, 792)
    paragraph.drawOn(canvas, 54, y - height)
    y -= height + style.spaceAfter
canvas.save()
