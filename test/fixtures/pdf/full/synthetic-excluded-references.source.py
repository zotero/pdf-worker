# SPDX-License-Identifier: CC0-1.0
from pathlib import Path
from reportlab import rl_config
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph

rl_config.useA85 = 0
output = Path(__file__).with_name('synthetic-excluded-references.pdf')
c = Canvas(str(output), pagesize=(612, 792), invariant=1, pageCompression=1)
c.setTitle('Synthetic references and page furniture')
c.setAuthor('Zotero document-worker contributors')
c.setSubject('CC0-1.0 synthetic regression fixture')
style = ParagraphStyle('body', fontName='Times-Roman', fontSize=11, leading=15)

def paragraph(text, y):
    p = Paragraph(text, style)
    _, height = p.wrap(504, 792)
    p.drawOn(c, 54, y - height)

def furniture():
    c.setFont('Times-Roman', 10)
    c.drawString(54, 760, 'Working notes (3), Figure 2')
    c.drawString(54, 28, 'Navigation to Figure 2')
    c.linkRect('', 'figure-two', (54 + c.stringWidth('Navigation to ', 'Times-Roman', 10), 26, 54 + c.stringWidth('Navigation to Figure 2', 'Times-Roman', 10), 38), relative=0, thickness=0)

furniture()
c.setFont('Times-Bold', 15)
c.drawString(54, 703, 'Synthetic semantic flow')
paragraph('The invented study compares two measurements. Equation (3) defines their total, '
          'and <b>Figure</b> 2 shows the relationship between the measured values. Both references '
          'belong to the main text. Figure 2 makes the same comparison visually, while '
          'Equation (3) gives its algebraic form.', 670)
paragraph('The page header is repeated for orientation. Its mathematical notation and figure '
          'label are deliberately identical to labels used in the document. The footer has '
          'an authored navigation link whose destination is supplied by the PDF.', 586)
paragraph('A second comparison uses Equation (2.1) and Equation (2.10). These labels identify '
          'different calculations. Figure 2.10 illustrates the second calculation, while '
          'Figure 7 is reused for two separate trials and does not identify a unique plot.', 510)
paragraph('The values f(3) and (3) are also ordinary mathematical notation. The list of '
          'operations is (1) measure, (2) combine, and (3) compare. A printed number alone '
          'does not explain the purpose of the notation.', 422)
paragraph('The <b>Figure</b> 2 comparison can also be opened through an authored '
          '<link href="#figure-two">2</link> in this paragraph. Figure 2 is mentioned again '
          'when describing the measurements, without changing the destination. The '
          'comparison also follows (<link href="#equation-three">3)</link> when combining the variables.', 334)
paragraph('For a descriptive link, consult <link href="#figure-two"><b>Figure 2.</b> Invented '
          'measurements shown as a rising line.</link> for all values.', 250)
paragraph('The <link href="#discussion">Comparison of the results</link> section explains '
          'the procedure. The observations use the invented studies of Cedar (2024), '
          'Willow (2023), and Maple (2022).', 180)
c.setFont('Times-Roman', 11)
c.drawString(54, 110, 'An explanatory note')
marker_x = 54 + c.stringWidth('An explanatory note', 'Times-Roman', 11)
c.setFont('Times-Roman', 7)
c.drawString(marker_x, 115, '1')
c.setFont('Times-Roman', 11)
c.drawString(marker_x + 3.5, 110, ' explains the origin of the measurements.')
c.setFont('Times-Roman', 7)
c.drawString(54, 65, '1')
c.setFont('Times-Roman', 11)
c.drawString(61, 60, 'The measurements in this document were invented for the example.')
c.showPage()
furniture()
c.setFont('Times-Bold', 15)
c.drawString(54, 703, 'Constructed measurements')
paragraph('Two invented variables describe the experiment. Their total is written below, '
          'with the equation number aligned at the right margin. The construction supplies '
          'a known destination for references in the surrounding narrative.', 670)
c.setFont('Times-Italic', 13)
c.bookmarkHorizontalAbsolute('equation-three', 590, 535)
c.drawCentredString(290, 580, 'x + y = z')
c.setFont('Times-Roman', 11)
c.drawRightString(558, 580, '(3)')
c.line(155, 350, 155, 510)
c.line(155, 350, 460, 350)
c.line(165, 360, 240, 387)
c.line(240, 387, 330, 428)
c.line(330, 428, 445, 493)
c.bookmarkHorizontalAbsolute('figure-two', 325, 54)
c.setFont('Times-Roman', 11)
c.drawString(54, 312, 'Figure 2. Invented measurements shown as a rising line.')
paragraph('The illustration uses only vector strokes and has no external source. Its caption '
          'supplies the figure label referenced throughout this document.', 275)
c.showPage()
furniture()
c.setFont('Times-Bold', 15)
c.bookmarkHorizontalAbsolute('discussion', 715, 54)
c.drawString(54, 703, 'Comparison of the results')
paragraph('The final comparison uses equation (3) to combine the observations. The pattern '
          'in Figure 2 agrees with that construction. These ordinary references must keep '
          'their existing destinations after page furniture is excluded from inference.', 670)
paragraph('Repeated text at the page edge should not create additional semantic claims. '
          'Explicit navigation remains available through the authored link in the footer.', 586)
continued_text = 'A closer reading of Figure 2 connects the measurements to the calculation. '
explanation = ('Each observation is recorded before the variables are combined. The same '
               'scale is used throughout the comparison so that the measured differences '
               'can be interpreted consistently. ')
while Paragraph(continued_text, style).wrap(504, 792)[1] <= 450:
    continued_text += explanation
continued_style = ParagraphStyle('continued', parent=style, alignment=4)
continued = Paragraph(continued_text + 'The comparison returns to Figure 2 and then uses '
                      'Equation (3) to summarize the measurements.', continued_style)
first_part, next_part = continued.split(504, 450)
first_part.wrap(504, 450)
first_part.drawOn(c, 54, 500 - first_part.height)
c.showPage()
furniture()
_, continuation_height = next_part.wrap(504, 792)
next_part.drawOn(c, 54, 745 - continuation_height)
c.setFont('Times-Bold', 15)
c.drawString(54, 655, 'Two forms of the calculation')
paragraph('The first calculation combines the measured variables. The second repeats the '
          'operation with a different scale. Each displayed expression has its own label.', 620)
c.setFont('Times-Italic', 13)
c.drawCentredString(290, 570, 'a + b = c')
c.setFont('Times-Roman', 11)
c.drawRightString(558, 570, '(2.1)')
paragraph('The repeated calculation uses a scale factor. Its dotted label records the '
          'full identifier used in the discussion of this expression.', 510)
c.setFont('Times-Italic', 13)
c.drawCentredString(290, 420, 'a + b = 2c')
c.setFont('Times-Roman', 11)
c.drawRightString(558, 420, '(2.10)')
paragraph('The relation in Eq. (2.10) differs from Equation (2.1). Both can be compared with '
          'Equation (3). In particular, Equation (2.10) applies the scale twice.', 355)
paragraph('The notation below is a function evaluation inside mathematics. It does not '
          'supply another numbered equation for the discussion. A discussion of '
          'Equation (4) is outside this excerpt.', 260)
c.setFont('Times-Italic', 13)
c.drawCentredString(290, 190, 'g = f (4)')
c.showPage()
furniture()
c.setFont('Times-Bold', 15)
c.drawString(54, 703, 'Scaled and repeated trials')
paragraph('The scaled measurements appear in Figure 2.10. The following small panels repeat '
          'a trial with a label that is local to each panel. Figure 7 alone is ambiguous.', 670)
for y, label in [(540, '2.10'), (345, '7'), (150, '7')]:
    c.line(155, y, 155, y + 80)
    c.line(155, y, 460, y)
    c.line(165, y + 8, 445, y + 72)
    c.setFont('Times-Roman', 11)
    c.drawString(54, y - 28, 'Figure ' + label + '. Constructed observations for this trial.')
c.showPage()
furniture()
c.setFont('Times-Bold', 15)
c.drawString(54, 703, 'Sources and interpretation')
paragraph('The invented study of Cedar (2024) describes the measurement procedure. '
          'The numerical comparisons in Figure 2 and Equation (3) summarize the result.', 670)
c.setFont('Times-Bold', 12)
c.drawString(54, 530, 'References')
reference_style = ParagraphStyle('reference', parent=style, leftIndent=18, firstLineIndent=-18)
y = 502
for text in [
    'Cedar, A. (2024). Constructed measurement procedures. Journal of Examples, '
    '5, 21-29.',
    'Willow, B. (2023). Recorded observations and comparisons. Journal of Examples, '
    '4, 31-39.',
    'Maple, C. (2022). Combining invented variables. Journal of Examples, '
    '3, 41-49.',
]:
    p = Paragraph(text, reference_style)
    _, height = p.wrap(504, 792)
    p.drawOn(c, 54, y - height)
    y -= height + 12
c.showPage()
c.save()
