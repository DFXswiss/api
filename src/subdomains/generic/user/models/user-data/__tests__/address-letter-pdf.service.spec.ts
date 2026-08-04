import { Test, TestingModule } from '@nestjs/testing';
import PDFDocument from 'pdfkit';
import { Config } from 'src/config/config';
import { TestUtil } from 'src/shared/utils/test.util';
import { AddressLetterPdfInput, AddressLetterPdfService } from '../address-letter-pdf.service';

describe('AddressLetterPdfService', () => {
  let service: AddressLetterPdfService;

  // synthetic test data only (public repo) — never a real customer name, address or account id
  const input: AddressLetterPdfInput = {
    userDataId: 999001,
    name: 'Testina Musterfrau',
    street: 'Teststrasse',
    houseNumber: '42',
    zip: '9999',
    city: 'Musterstadt',
    country: 'Schweiz',
    date: new Date('2026-08-04T12:09:01.000Z'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AddressLetterPdfService, TestUtil.provideConfig()],
    }).compile();

    service = module.get<AddressLetterPdfService>(AddressLetterPdfService);
  });

  // Captures every string drawn through pdfkit's `text`, independent of the compressed output stream.
  async function render(overrides: Partial<AddressLetterPdfInput> = {}): Promise<string[]> {
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
      await service.generatePdf({ ...input, ...overrides });
    } finally {
      spy.mockRestore();
    }

    return texts;
  }

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('renders a valid, single-page, base64-encoded PDF', async () => {
    const { base64, pageCount } = await service.generatePdf(input);

    const buffer = Buffer.from(base64, 'base64');
    // re-encoding is loss-less for valid base64
    expect(buffer.toString('base64')).toBe(base64);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount).toBe(1);
  });

  it('prints the recipient block the envelope window shows', async () => {
    const texts = await render();

    expect(texts).toContain('Testina Musterfrau\nTeststrasse 42\n9999 Musterstadt\nSchweiz');
  });

  it('drops an empty street part instead of printing a blank line', async () => {
    const texts = await render({ houseNumber: undefined });

    expect(texts).toContain('Testina Musterfrau\nTeststrasse\n9999 Musterstadt\nSchweiz');
  });

  it('carries the sender line above the address window', async () => {
    const texts = await render();
    const { name, street, number, zip, city, country } = Config.bank.dfxAddress;

    expect(texts).toContain(`${name} · ${street} ${number} · ${zip} ${city} · ${country}`);
  });

  it('addresses the recipient and names the account as reference', async () => {
    const texts = await render();

    expect(texts).toContain('Guten Tag Testina Musterfrau');
    expect(texts).toContain('Referenz: 999001');
    expect(texts).toContain('Adressverifikation');
  });

  it('dates the letter in the local format of the sender', async () => {
    const texts = await render();

    expect(texts).toContain(`${Config.bank.dfxAddress.city}, 04.08.2026`);
  });

  it('pads a single-digit day and month', async () => {
    const texts = await render({ date: new Date('2026-01-02T10:00:00.000Z') });

    expect(texts).toContain(`${Config.bank.dfxAddress.city}, 02.01.2026`);
  });

  it('points a misdelivered letter at support', async () => {
    const texts = await render();

    expect(texts.some((t) => t.includes(Config.mail.contact.supportMail))).toBe(true);
  });

  it('rejects instead of resolving when rendering fails', async () => {
    jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(() => {
      throw new Error('render boom');
    });

    await expect(service.generatePdf(input)).rejects.toThrow('render boom');
  });
});
