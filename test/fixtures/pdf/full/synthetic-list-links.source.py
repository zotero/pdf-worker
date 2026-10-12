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
canvas.drawString(54, 710, "The invented sources [1-6] illustrate independent reference items.")
canvas.drawString(54, 690, "A paragraph link remains intact: https://example.org/paragraph.")
canvas.setFont("Times-Bold", 12)
canvas.drawString(54, 658, "References")

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
y = 637
for text in items:
    paragraph = Paragraph(text, style)
    _, height = paragraph.wrap(490, 792)
    paragraph.drawOn(canvas, 54, y - height)
    y -= height + style.spaceAfter
canvas.save()
