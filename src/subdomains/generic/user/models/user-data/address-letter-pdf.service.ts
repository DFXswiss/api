import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Config } from 'src/config/config';
import { LogoSize, PdfBrand, PdfUtil } from 'src/shared/utils/pdf.util';
import { mm2pt } from 'swissqrbill/utils';

export interface AddressLetterPdfInput {
  userDataId: number;
  name: string;
  street?: string;
  houseNumber?: string;
  zip: string;
  city: string;
  country: string;
  date: Date;
}

export interface AddressLetterPdf {
  base64: string;
  // Rendered page count. The dispatch provider is billed per page and `SendLetterDto.page` carries the
  // number, so it is measured instead of assumed - a name or street long enough to wrap must not
  // silently turn a one-page letter into a two-page job billed as one.
  pageCount: number;
}

/**
 * Renders the address verification letter that is printed and posted by the dispatch provider
 * (`LetterService`). Pure rendering, no DB access, no side effects.
 *
 * Geometry follows the Swiss window-envelope norm (SN 010130, C5/6), which the printer requires: the
 * recipient block starts 45 mm from the top edge and 20 mm from the left, is at most 45 mm wide and
 * carries a sender line above it. Everything else (logo, date, subject, body, signature) is placed
 * outside that window area.
 *
 * The wording below is DFX's own and is deliberately kept minimal: the letter only has to arrive, it
 * asks the recipient for nothing. It is NOT yet a verified transcription of the spreadsheet template
 * this job replaces - that comparison needs the live document and is the open point tracked in the
 * pull request. Layout and text are separated for exactly that reason: correcting the wording is a
 * change to `TEXT` alone.
 */
// Module scope, not a class field: reading `Config` in a field initializer of an @Injectable runs
// before `ConfigService` exists and would crash the bootstrap. Every entry that needs configuration is
// a function, so it is evaluated when the letter is rendered.
const TEXT = {
  subject: 'Adressverifikation',
  salutation: (name: string) => `Guten Tag ${name}`,
  body: () => [
    'Zur Verifikation Ihrer Wohnadresse senden wir Ihnen dieses Schreiben per Post an die von Ihnen ' +
      'hinterlegte Adresse.',
    'Sie müssen nichts weiter unternehmen. Mit dem Versand dieses Briefes ist die Adressprüfung für ' +
      'Ihr Konto abgeschlossen.',
    `Sollten Sie dieses Schreiben irrtümlich erhalten haben oder die oben genannte Adresse nicht die ` +
      `Ihre sein, melden Sie sich bitte umgehend bei ${Config.mail.contact.supportMail}.`,
  ],
  closing: 'Freundliche Grüsse',
  reference: (userDataId: number) => `Referenz: ${userDataId}`,
};

@Injectable()
export class AddressLetterPdfService {
  // Swiss window-envelope geometry (SN 010130), in millimetres.
  private static readonly MARGIN_LEFT = 20;
  private static readonly MARGIN_RIGHT = 20;
  private static readonly SENDER_LINE_TOP = 40;
  private static readonly ADDRESS_TOP = 45;
  private static readonly ADDRESS_WIDTH = 85;
  private static readonly BODY_TOP = 100;

  private static readonly TEXT_COLOR = '#000000';

  async generatePdf(input: AddressLetterPdfInput): Promise<AddressLetterPdf> {
    return new Promise<AddressLetterPdf>((resolve, reject) => {
      try {
        const pdf = new PDFDocument({
          size: 'A4',
          margin: mm2pt(AddressLetterPdfService.MARGIN_LEFT),
          bufferPages: true,
        });
        const chunks: Buffer[] = [];
        let pageCount = 0;

        pdf.on('data', (chunk) => chunks.push(chunk));
        pdf.on('end', () => resolve({ base64: Buffer.concat(chunks).toString('base64'), pageCount }));

        const { MARGIN_LEFT, MARGIN_RIGHT, SENDER_LINE_TOP, ADDRESS_TOP, ADDRESS_WIDTH, BODY_TOP, TEXT_COLOR } =
          AddressLetterPdfService;
        const left = mm2pt(MARGIN_LEFT);
        const contentWidth = pdf.page.width - mm2pt(MARGIN_LEFT + MARGIN_RIGHT);

        PdfUtil.drawLogo(pdf, PdfBrand.DFX, LogoSize.LARGE);

        // sender line above the address window, as the norm requires for a window envelope
        pdf.fontSize(7).font('Helvetica').fillColor(TEXT_COLOR);
        pdf.text(this.senderLine(), left, mm2pt(SENDER_LINE_TOP), { width: mm2pt(ADDRESS_WIDTH) });

        // recipient block inside the envelope window
        pdf.fontSize(11).font('Helvetica').fillColor(TEXT_COLOR);
        pdf.text(this.recipientBlock(input).join('\n'), left, mm2pt(ADDRESS_TOP), { width: mm2pt(ADDRESS_WIDTH) });

        // place and date, right aligned, below the window
        pdf.fontSize(11).font('Helvetica');
        pdf.text(`${Config.bank.dfxAddress.city}, ${this.germanDate(input.date)}`, left, mm2pt(BODY_TOP - 12), {
          width: contentWidth,
          align: 'right',
        });

        pdf.fontSize(12).font('Helvetica-Bold');
        pdf.text(TEXT.subject, left, mm2pt(BODY_TOP), { width: contentWidth });

        pdf.moveDown(1.5);
        pdf.fontSize(11).font('Helvetica');
        pdf.text(TEXT.salutation(input.name), { width: contentWidth });

        for (const paragraph of TEXT.body()) {
          pdf.moveDown(1);
          pdf.text(paragraph, { width: contentWidth, align: 'justify' });
        }

        pdf.moveDown(2);
        pdf.text(TEXT.closing, { width: contentWidth });
        pdf.moveDown(0.5);
        pdf.font('Helvetica-Bold').text(Config.bank.dfxAddress.name, { width: contentWidth });

        pdf.moveDown(2);
        pdf.fontSize(8).font('Helvetica').text(TEXT.reference(input.userDataId), { width: contentWidth });

        // read before end(): `end()` flushes the buffered pages, after which the range is empty again
        pageCount = pdf.bufferedPageRange().count;

        pdf.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  // *** HELPER METHODS *** //

  private senderLine(): string {
    const { name, street, number, zip, city, country } = Config.bank.dfxAddress;
    return `${name} · ${street} ${number} · ${zip} ${city} · ${country}`;
  }

  // Name, street line, "zip city", country - one entry per line, empty parts dropped. The country is
  // always printed: the dispatch provider routes national vs. international on the job specification,
  // and a letter leaving Switzerland needs the destination country on the envelope either way.
  private recipientBlock(input: AddressLetterPdfInput): string[] {
    const streetLine = [input.street, input.houseNumber].filter((p) => p).join(' ');
    return [input.name, streetLine, `${input.zip} ${input.city}`, input.country].filter((line) => line);
  }

  private germanDate(date: Date): string {
    return `${`${date.getDate()}`.padStart(2, '0')}.${`${date.getMonth() + 1}`.padStart(2, '0')}.${date.getFullYear()}`;
  }
}
