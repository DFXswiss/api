import { Test, TestingModule } from '@nestjs/testing';
import PDFDocument from 'pdfkit';
import { Config } from 'src/config/config';
import { PdfUtil } from 'src/shared/utils/pdf.util';
import { TestUtil } from 'src/shared/utils/test.util';
import { TravelRulePdfInput, TravelRulePdfService } from './travel-rule-pdf.service';

describe('TravelRulePdfService', () => {
  let service: TravelRulePdfService;

  // synthetic test data only (public repo) — never real addresses/signatures/ids
  const input: TravelRulePdfInput = {
    id: 999001,
    userDataId: 888001,
    address: '0xSyntheticAddress',
    signature: '0xSyntheticSignature',
    date: new Date('2026-06-25T21:06:48.000Z'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TravelRulePdfService, TestUtil.provideConfig()],
    }).compile();

    service = module.get<TravelRulePdfService>(TravelRulePdfService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // Captures every string drawn via pdfkit's `text`, plus the per-call options (so the verification
  // `link` annotation can be asserted), independent of the flate-compressed output stream.
  async function render(
    overrides: Partial<TravelRulePdfInput> = {},
  ): Promise<{ texts: string[]; links: { value: string; uri: string }[] }> {
    const texts: string[] = [];
    const links: { value: string; uri: string }[] = [];

    const originalText = PDFDocument.prototype.text;
    const spy = jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (
      this: PDFKit.PDFDocument,
      value: string,
      ...rest: any[]
    ) {
      if (typeof value === 'string') {
        texts.push(value);
        const options = rest.find((arg) => arg && typeof arg === 'object');
        if (options?.link) links.push({ value, uri: options.link });
      }
      return originalText.call(this, value, ...rest);
    });

    try {
      await service.generatePdf({ ...input, ...overrides });
    } finally {
      spy.mockRestore();
    }

    return { texts, links };
  }

  it('renders a valid base64-encoded PDF', async () => {
    const base64 = await service.generatePdf(input);

    expect(typeof base64).toBe('string');
    expect(base64.length).toBeGreaterThan(0);

    const buffer = Buffer.from(base64, 'base64');
    // re-encoding is loss-less for valid base64
    expect(buffer.toString('base64')).toBe(base64);
    // a PDF stream starts with the "%PDF" magic bytes
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('renders both bold title lines', async () => {
    const { texts } = await render();

    expect(texts).toContain('Travel Rule');
    expect(texts).toContain('Digitale Signatur Kontrolle');
  });

  it('renders the metadata labels and their values (Id / Date / User Data ID)', async () => {
    const { texts } = await render();

    expect(texts).toContain('Id');
    expect(texts).toContain('Date');
    expect(texts).toContain('User Data ID');

    // values
    expect(texts).toContain('999001');
    expect(texts).toContain('888001');

    // the date is rendered as a readable UTC date+time (with explicit UTC suffix), NOT a raw serial
    const date = texts.find((t) => t.startsWith('2026-06-25'));
    expect(date).toBe('2026-06-25 21:06:48 UTC');
    expect(texts).not.toContain('46198.87754');
  });

  it('renders the Kontrolle section header and control labels', async () => {
    const { texts } = await render();

    expect(texts).toContain('Kontrolle');
    expect(texts).toContain('Address:');
    expect(texts).toContain('Signatur Text:');
    expect(texts).toContain('Signatur:');
    expect(texts).toContain('Kontrolle:');
  });

  it('renders the address value', async () => {
    const { texts } = await render();
    expect(texts).toContain(input.address);
  });

  it('renders the signed message VERBATIM — signMessageGeneral + address, underscores kept (no replace)', async () => {
    const { texts } = await render();

    // exactly the message the user signed: the statement (WITH underscores, never replaced) directly
    // followed by the address, joined without separator — mirroring auth.service / the sheet 1:1
    const signedMessage = Config.auth.signMessageGeneral + input.address;
    expect(texts).toContain(signedMessage);

    // sanity: the statement really still contains underscores (guards against an accidental replace)
    expect(signedMessage).toContain('_');
    expect(texts.some((t) => t.includes('By signing this message'))).toBe(false);
  });

  it('renders the signature verbatim incl. the ;<key> suffix (Cardano CIP-30 COSE), never split', async () => {
    const signature = '8458200a;a4010103272006215820deadbeef';
    const { texts } = await render({ signature });

    // the full value including the part after the semicolon is rendered as a single, unsplit string
    expect(texts).toContain(signature);
    // and nothing was rendered that is merely the part before the `;`
    expect(texts).not.toContain('8458200a');
  });

  it('renders the Kontrolle link as a verifycryptomessage.com annotation with encoded message & signature', async () => {
    const { texts, links } = await render();

    const signedMessage = Config.auth.signMessageGeneral + input.address;
    const expectedUri =
      `https://verifycryptomessage.com/?address=${input.address}` +
      `&message=${encodeURIComponent(signedMessage)}` +
      `&signature=${encodeURIComponent(input.signature)}`;

    // the link is rendered with the display text "Link" (matching the sheet) ...
    expect(texts).toContain('Link');
    // ... and exactly one pdfkit link annotation pointing at the verification URL was emitted
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({ value: 'Link', uri: expectedUri });

    // the underscores of the signed message survive url-encoding (encodeURIComponent leaves `_`),
    // while the comma/colon are percent-encoded exactly like the sheet's ENCODEURL
    expect(links[0].uri).toContain('Your_ID%3A_');
    expect(links[0].uri).toContain('message%2C_you');
  });

  it('rejects the promise when PDF rendering throws', async () => {
    const renderError = new Error('logo render failed');
    const spy = jest.spyOn(PdfUtil, 'drawLogo').mockImplementation(() => {
      throw renderError;
    });

    try {
      await expect(service.generatePdf(input)).rejects.toThrow(renderError);
    } finally {
      spy.mockRestore();
    }
  });
});
