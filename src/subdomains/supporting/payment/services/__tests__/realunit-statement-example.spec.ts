import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import { I18nModule, I18nService } from 'nestjs-i18n';
import * as path from 'path';
import { ConfigService, GetConfig } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { extractPdfText } from 'src/shared/utils/__tests__/pdf-text.util';
import { BalanceEntry, PdfUtil } from 'src/shared/utils/pdf.util';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { PriceCurrency } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { SwissQRService } from '../swiss-qr.service';

/**
 * Renders the RealUnit portfolio statement ("Vermögensübersicht") straight from {@link SwissQRService}
 * (the same code path the `POST /v1/realunit/balance/pdf` endpoint uses) and validates the output is a
 * well-formed PDF in the receipt letter design.
 *
 * The committed sample PDF in `docs/examples/realunit-statement/` is produced by this test. To
 * regenerate it after a layout/i18n change, run:
 *
 *   GENERATE_STATEMENT_EXAMPLE=true npx jest realunit-statement-example
 *
 * Without the env flag the test only renders + asserts (no file writes), so it stays deterministic in CI.
 */
const OUTPUT_DIR = path.join(process.cwd(), 'docs/examples/realunit-statement');

// Fixed sample data so the rendered example is reproducible.
const ADDRESS = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984';
const REALU_ASSET = { name: 'REALU', description: 'RealUnit Shares', blockchain: 'Ethereum' } as Asset;
const AS_OF = new Date('2025-12-31T00:00:00Z'); // reference date within a configured tax year (CHF 1.37)

// A wallet holding 1'234 REALU shares valued at the official 2025 tax value.
const BALANCES: BalanceEntry[] = [{ asset: REALU_ASSET, balance: 1234, price: 1.37, value: 1234 * 1.37 }];
const TOTAL_VALUE = 1234 * 1.37;

const holder = {
  completeName: 'Max Mustermann',
  isInvoiceDataComplete: true,
  language: { symbol: 'DE' },
  address: { street: 'Musterstrasse', houseNumber: '12', zip: '8002', city: 'Zürich', country: { symbol: 'CH' } },
} as unknown as UserData;

// Incomplete profile: getDebtor returns undefined, so the statement must degrade to name-only.
const nameOnlyHolder = {
  completeName: 'Erika Muster',
  isInvoiceDataComplete: false,
  language: { symbol: 'DE' },
} as unknown as UserData;

// German statement labels, read from the shipped i18n so the content assertions track the real rendered
// strings instead of hard-coded duplicates.
const DE_BALANCE = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/shared/i18n/de/balance.json'), 'utf8'));

function expectValidPdf(base64: string): Buffer {
  const buf = Buffer.from(base64, 'base64');
  expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(buf.length).toBeGreaterThan(2000);
  return buf;
}

// RealUnit documents carry the calendar date only — never a clock time (no HH:mm anywhere).
function expectNoClockTime(text: string): void {
  expect(text).not.toMatch(/\b\d{1,2}:\d{2}\b/);
}

function writeExample(name: string, base64: string): void {
  if (process.env.GENERATE_STATEMENT_EXAMPLE !== 'true') return;
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, name), Buffer.from(base64, 'base64'));
}

describe('SwissQRService — RealUnit portfolio statement example', () => {
  let service: SwissQRService;

  beforeAll(async () => {
    // Populate the global `Config` singleton (normally wired up at app bootstrap).
    new ConfigService();

    const i18nConfig = GetConfig().i18n;
    const module = await Test.createTestingModule({
      imports: [I18nModule.forRoot({ ...i18nConfig, loaderOptions: { ...i18nConfig.loaderOptions, watch: false } })],
    }).compile();

    service = new SwissQRService({} as never, module.get(I18nService));
  });

  it('renders the portfolio statement in the receipt letter design (DE)', async () => {
    const pdf = await service.createBalanceStatement(
      BALANCES,
      TOTAL_VALUE,
      holder,
      PriceCurrency.CHF,
      AS_OF,
      'DE',
      ADDRESS,
    );

    expectValidPdf(pdf);
    const text = extractPdfText(pdf);

    // Title reuses the balance.title key ("Vermögensübersicht"), no document number.
    expect(text).toContain(DE_BALANCE.title);
    expect(text).toContain('REALU');
    // Holder identity from userData, printed in the recipient block and the details section.
    expect(text).toContain('Max Mustermann');
    // "Baar, <reference date>" — place from Config, Swiss date-only formatting.
    expect(text).toContain('Baar');
    expect(text).toContain('31.12.2025');
    // Issuer attribution stays on the statement.
    expect(text).toContain('RealUnit Schweiz AG');

    // Never the raw wallet address — only a short, non-reversible hash reference.
    const reference = PdfUtil.walletReference(ADDRESS);
    expect(reference).toHaveLength(6);
    expect(text).toContain(reference);
    expect(text.toLowerCase()).not.toContain(ADDRESS.toLowerCase());

    expectNoClockTime(text);
    writeExample('vermoegensuebersicht-de.pdf', pdf);
  });

  it('renders the portfolio statement (EN)', async () => {
    const pdf = await service.createBalanceStatement(
      BALANCES,
      TOTAL_VALUE,
      holder,
      PriceCurrency.CHF,
      AS_OF,
      'EN',
      ADDRESS,
    );

    expectValidPdf(pdf);
    writeExample('vermoegensuebersicht-en.pdf', pdf);
  });

  it('degrades to name-only for an incomplete profile without hard-erroring', async () => {
    const pdf = await service.createBalanceStatement(
      BALANCES,
      TOTAL_VALUE,
      nameOnlyHolder,
      PriceCurrency.CHF,
      AS_OF,
      'DE',
      ADDRESS,
    );

    expectValidPdf(pdf);
    const text = extractPdfText(pdf);
    expect(text).toContain('Erika Muster');
    expect(text).toContain('RealUnit Schweiz AG');
    expectNoClockTime(text);
  });

  it('refuses to issue a statement when a holding cannot be priced (fail-closed)', async () => {
    // A reference year without a configured official RealUnit tax value leaves the holding unpriced
    // (value undefined). The statement must be rejected, never rendered with "n/a" and a zeroed total.
    const unpriced: BalanceEntry[] = [{ asset: REALU_ASSET, balance: 1234, price: undefined, value: undefined }];
    await expect(
      service.createBalanceStatement(unpriced, 0, holder, PriceCurrency.CHF, AS_OF, 'DE', ADDRESS),
    ).rejects.toThrow(BadRequestException);
  });

  // Guards against a missing/typo'd i18n key silently printing the raw key on a customer tax document:
  // every statement label must exist in every supported language.
  it('has every statement i18n key in all supported languages', () => {
    const statementKeys = [
      'title',
      'table.headers.asset',
      'table.headers.balance',
      'table.headers.price',
      'table.headers.value',
      'table.no_assets',
      'statement.details_title',
      'statement.holder_label',
      'statement.reference_date_label',
      'statement.wallet_reference_label',
      'total_value',
      'generated_by_realunit',
    ];

    const missing: string[] = [];
    for (const lang of ['de', 'en', 'fr', 'it']) {
      const balance = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), 'src/shared/i18n', lang, 'balance.json'), 'utf8'),
      );
      for (const key of statementKeys) {
        const value = key.split('.').reduce<any>((node, part) => node?.[part], balance);
        if (typeof value !== 'string' || value.length === 0) missing.push(`${lang}: balance.${key}`);
      }
    }

    expect(missing).toEqual([]);
  });
});
