import { Test, TestingModule } from '@nestjs/testing';
import PDFDocument from 'pdfkit';
import { Config } from 'src/config/config';
import { PdfUtil } from 'src/shared/utils/pdf.util';
import { TestUtil } from 'src/shared/utils/test.util';
import { TravelRulePdfService } from './travel-rule-pdf.service';

describe('TravelRulePdfService', () => {
  let service: TravelRulePdfService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TravelRulePdfService, TestUtil.provideConfig()],
    }).compile();

    service = module.get<TravelRulePdfService>(TravelRulePdfService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // captures every string drawn via pdfkit's `text` so we can assert what is rendered, independent
  // of the (flate-compressed) output stream
  async function renderedTexts(address: string, signature: string): Promise<string[]> {
    const texts: string[] = [];
    const originalText = PDFDocument.prototype.text;
    const spy = jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (
      this: PDFKit.PDFDocument,
      value: string,
      ...rest: any[]
    ) {
      if (typeof value === 'string') texts.push(value);
      return originalText.call(this, value, ...rest);
    });

    try {
      await service.generateAddressSignaturePdf(address, signature);
    } finally {
      spy.mockRestore();
    }

    return texts;
  }

  it('renders a valid base64-encoded PDF', async () => {
    const base64 = await service.generateAddressSignaturePdf('0xabc', 'deadbeef');

    expect(typeof base64).toBe('string');
    expect(base64.length).toBeGreaterThan(0);

    const buffer = Buffer.from(base64, 'base64');
    // re-encoding is loss-less for valid base64
    expect(buffer.toString('base64')).toBe(base64);
    // a PDF stream starts with the "%PDF" magic bytes
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('renders a plain signature verbatim', async () => {
    const texts = await renderedTexts('0xabc', 'signatureOnly');
    expect(texts).toContain('signatureOnly');
  });

  it('renders the ;<key> suffix verbatim (Cardano CIP-30 COSE), never splitting it', async () => {
    const signature = '8458200a;a4010103272006215820deadbeef';
    const texts = await renderedTexts('addr1qxy', signature);

    // the full value including the part after the semicolon is rendered as a single, unsplit string
    expect(texts).toContain(signature);
    // and nothing was rendered that is merely the part before the `;`
    expect(texts).not.toContain('8458200a');
  });

  it('renders the signed message statement and address as one contiguous string (Q M5)', async () => {
    const address = '0xDEADBEEF';
    const texts = await renderedTexts(address, 'sig');

    // exactly mirrors the signed message: statement (underscores → spaces) directly followed by the
    // address, joined without separator — exactly how auth.service builds the message that was signed
    const statement = Config.auth.signMessageGeneral.replace(/_/g, ' ');
    expect(texts).toContain(statement + address);

    // the address is NOT rendered as a separate field — it only ever appears glued onto the
    // statement, never on its own (which would mean the PDF no longer mirrors the signed message)
    expect(texts).not.toContain(address);
    expect(texts.some((t) => t.includes(address) && t !== statement + address)).toBe(false);
  });

  it('rejects the promise when PDF rendering throws', async () => {
    const renderError = new Error('logo render failed');
    const spy = jest.spyOn(PdfUtil, 'drawLogo').mockImplementation(() => {
      throw renderError;
    });

    try {
      await expect(service.generateAddressSignaturePdf('0xabc', 'sig')).rejects.toThrow(renderError);
    } finally {
      spy.mockRestore();
    }
  });
});
