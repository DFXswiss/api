import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { LogoSize, PdfBrand, PdfUtil } from 'src/shared/utils/pdf.util';

export interface TravelRulePdfInput {
  id: number;
  userDataId: number;
  address: string;
  signature: string;
  date: Date;
}

@Injectable()
export class TravelRulePdfService {
  private static readonly MARGIN_X = 50;
  private static readonly LABEL_WIDTH = 140;
  private static readonly BORDER_COLOR = '#000000';
  private static readonly TEXT_COLOR = '#000000';
  private static readonly LINK_COLOR = '#0000FF';

  /**
   * Renders the Travel-Rule address-ownership control PDF — a 1:1 replica of the source-of-truth
   * Google-Sheet `editPDF` template (sheet 1teiHIqfHPBCv04Y1NLeyz1jZaGk3A_1_du9OhtNadFs). Pure
   * rendering, no DB access.
   *
   * Layout (top → bottom): DFX logo (top-right); two-line bold title
   * ("Travel Rule" / "Digitale Signatur Kontrolle"); a bordered metadata table (Id / Date / User
   * Data ID); a "Kontrolle" section header; a bordered control box (Address / Signatur Text /
   * Signatur / Kontrolle-link).
   *
   * `Signatur Text` is `Config.auth.signMessageGeneral + address` VERBATIM (underscores kept, NOT
   * replaced) — this is the exact message the user signed (auth.service joins statement+address
   * without separator). The signature is rendered verbatim too, including any `;<key>` suffix
   * (Cardano CIP-30 COSE) — never split. The `Kontrolle` link points at verifycryptomessage.com
   * with the same signed message and signature, url-encoded exactly like the sheet's `ENCODEURL`.
   */
  async generatePdf(input: TravelRulePdfInput): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      try {
        const pdf = new PDFDocument({ size: 'A4', margin: TravelRulePdfService.MARGIN_X });
        const chunks: Buffer[] = [];

        pdf.on('data', (chunk) => chunks.push(chunk));
        pdf.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));

        const { MARGIN_X } = TravelRulePdfService;
        const { width } = pdf.page;
        const contentWidth = width - MARGIN_X * 2;

        // exact signed message + verification link (built once, reused below)
        const signedMessage = Config.auth.signMessageGeneral + input.address;
        const verifyLink = `https://verifycryptomessage.com/?address=${input.address}&message=${encodeURIComponent(
          signedMessage,
        )}&signature=${encodeURIComponent(input.signature)}`;

        // header: DFX logo top-right. The DFX logo path is ~541 units wide; at the SMALL scale (0.12)
        // that is ~65pt, so translating to `width - MARGIN_X - 65` aligns its right edge with the margin.
        PdfUtil.drawLogo(pdf, PdfBrand.DFX, LogoSize.SMALL, width - MARGIN_X - 65);

        // title (two bold lines)
        pdf.fontSize(20).font('Helvetica-Bold').fillColor(TravelRulePdfService.TEXT_COLOR);
        pdf.text('Travel Rule', MARGIN_X, 90, { width: contentWidth });
        pdf.text('Digitale Signatur Kontrolle', MARGIN_X, undefined, { width: contentWidth });

        let y = pdf.y + 30;

        // metadata table (Id / Date / User Data ID)
        y = this.drawBoxedTable(pdf, MARGIN_X, y, contentWidth, [
          { label: 'Id', value: `${input.id}` },
          // readable UTC date+time (the sheet stored a raw serial number) — Util.isoDate/isoTime use
          // `toISOString()`, i.e. UTC; the `UTC` suffix makes the timezone explicit on the document
          { label: 'Date', value: `${Util.isoDate(input.date)} ${Util.isoTime(input.date).replace(/-/g, ':')} UTC` },
          { label: 'User Data ID', value: `${input.userDataId}` },
        ]);

        y += 30;

        // section header
        pdf.fontSize(13).font('Helvetica-Bold').fillColor(TravelRulePdfService.TEXT_COLOR);
        pdf.text('Kontrolle', MARGIN_X, y);
        y = pdf.y + 8;

        // control box (Address / Signatur Text / Signatur / Kontrolle-link)
        this.drawBoxedTable(pdf, MARGIN_X, y, contentWidth, [
          { label: 'Address:', value: input.address },
          { label: 'Signatur Text:', value: signedMessage },
          { label: 'Signatur:', value: input.signature },
          { label: 'Kontrolle:', value: 'Link', link: verifyLink },
        ]);

        pdf.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  // *** HELPER METHODS *** //

  // Renders a bordered label/value table mirroring the sheet's thin-bordered cells: each row has a
  // left label column and a right value column, the whole block framed and row-separated.
  private drawBoxedTable(
    pdf: InstanceType<typeof PDFDocument>,
    x: number,
    yStart: number,
    width: number,
    rows: { label: string; value: string; link?: string }[],
  ): number {
    const { LABEL_WIDTH, BORDER_COLOR, TEXT_COLOR, LINK_COLOR } = TravelRulePdfService;
    const valueX = x + LABEL_WIDTH;
    const valueWidth = width - LABEL_WIDTH;
    const padding = 4;
    const rowGap = 8;

    const rowTops: number[] = [];
    let y = yStart;

    for (const row of rows) {
      rowTops.push(y);
      const innerY = y + padding;

      // label
      pdf.fontSize(11).font('Helvetica-Bold').fillColor(TEXT_COLOR);
      pdf.text(row.label, x + padding, innerY, { width: LABEL_WIDTH - padding * 2 });
      const labelBottom = pdf.y;

      // value
      if (row.link) {
        pdf.fontSize(11).font('Helvetica').fillColor(LINK_COLOR);
        pdf.text(row.value, valueX + padding, innerY, {
          width: valueWidth - padding * 2,
          link: row.link,
          underline: true,
        });
      } else {
        pdf.fontSize(11).font('Helvetica').fillColor(TEXT_COLOR);
        pdf.text(row.value, valueX + padding, innerY, { width: valueWidth - padding * 2 });
      }
      const valueBottom = pdf.y;

      y = Math.max(labelBottom, valueBottom) + padding + rowGap;
    }

    rowTops.push(y);

    // frame + row separators + the label/value column divider
    pdf.lineWidth(0.75).strokeColor(BORDER_COLOR);
    pdf.rect(x, yStart, width, y - yStart).stroke();
    for (let i = 1; i < rowTops.length - 1; i++) {
      pdf
        .moveTo(x, rowTops[i])
        .lineTo(x + width, rowTops[i])
        .stroke();
    }
    pdf.moveTo(valueX, yStart).lineTo(valueX, y).stroke();

    return y;
  }
}
