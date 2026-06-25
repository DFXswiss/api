import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Config } from 'src/config/config';
import { LogoSize, PdfBrand, PdfUtil } from 'src/shared/utils/pdf.util';

@Injectable()
export class TravelRulePdfService {
  /**
   * Renders the address-ownership signature PDF (Travel Rule).
   *
   * Pure rendering, no DB access. The body intentionally mirrors the message the user actually
   * signed: `Config.auth.signMessageGeneral` (underscores replaced by spaces) directly followed by
   * the address (`auth.service.ts:419` joins them without separator). The signature is rendered
   * below in monospace so long, line-wrapping signatures stay legible.
   *
   * The signature is rendered verbatim — including any `;<key>` suffix (`auth.service.ts:163`,
   * 23/27298 Cardano CIP-30 COSE cases). The `;<key>` part is verification-relevant on those chains
   * and the source-of-truth sheet template copies the value 1:1, so no splitting must happen here.
   * The cron reads `user.signature` raw/unmasked via `userRepo.find` (not the masked /gs path).
   */
  async generateAddressSignaturePdf(address: string, signature: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      try {
        const pdf = new PDFDocument({ size: 'A4', margin: 50 });
        const chunks: Buffer[] = [];

        pdf.on('data', (chunk) => chunks.push(chunk));
        pdf.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));

        PdfUtil.drawLogo(pdf, PdfBrand.DFX, LogoSize.SMALL);

        const marginX = 50;
        const { width } = pdf.page;
        const contentWidth = width - marginX * 2;

        pdf.fontSize(20).font('Helvetica-Bold').fillColor('#072440');
        pdf.text('Travel Rule - Address Signature', marginX, 75, { width: contentWidth });

        pdf.moveDown(1.5);

        // exact signed message: statement text + address, rendered contiguously
        const statement = Config.auth.signMessageGeneral.replace(/_/g, ' ');
        pdf.fontSize(11).font('Helvetica').fillColor('#333333');
        pdf.text(statement + address, marginX, undefined, { width: contentWidth });

        pdf.moveDown(1.5);

        pdf.fontSize(11).font('Helvetica-Bold').fillColor('#072440');
        pdf.text('Signature:', marginX, undefined, { width: contentWidth });

        pdf.moveDown(0.5);

        // render the signature verbatim — never split the `;<key>` suffix (Cardano CIP-30 COSE)
        pdf.fontSize(9).font('Courier').fillColor('#333333');
        pdf.text(signature, marginX, undefined, { width: contentWidth });

        pdf.end();
      } catch (e) {
        reject(e);
      }
    });
  }
}
