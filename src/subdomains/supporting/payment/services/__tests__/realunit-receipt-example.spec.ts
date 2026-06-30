import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import { I18nModule, I18nService } from 'nestjs-i18n';
import * as path from 'path';
import { ConfigService, GetConfig } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PdfBrand } from 'src/shared/utils/pdf.util';
import { HistoryEventType } from 'src/subdomains/supporting/realunit/dto/client.dto';
import { HistoryEventDto } from 'src/subdomains/supporting/realunit/dto/realunit.dto';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { SwissQRService } from '../swiss-qr.service';

/**
 * Renders real RealUnit transaction-receipt PDFs straight from {@link SwissQRService}
 * (the same code path the `/v1/realunit/transactions/receipt/{single,multi}` endpoints use)
 * and validates the output is a well-formed PDF.
 *
 * The committed sample PDFs in `docs/examples/realunit-receipt/` are produced by this test.
 * To regenerate them after a layout/i18n change, run:
 *
 *   GENERATE_RECEIPT_EXAMPLES=true npx jest realunit-receipt-example
 *
 * Without the env flag the test only renders + asserts (no file writes), so it stays
 * deterministic in CI.
 */
const OUTPUT_DIR = path.join(process.cwd(), 'docs/examples/realunit-receipt');

// Fixed sample data so the rendered examples are reproducible.
const REALU_ASSET = { name: 'REALU', description: 'RealUnit Shares', blockchain: 'Ethereum' } as Asset;
const BUYER_WALLET = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984';
const ZERO = '0x0000000000000000000000000000000000000000';

const buyer = {
  completeName: 'Max Mustermann',
  isInvoiceDataComplete: true,
  language: { symbol: 'DE' },
  address: { street: 'Musterstrasse', houseNumber: '12', zip: '8002', city: 'Zürich', country: { symbol: 'CH' } },
} as unknown as UserData;

function event(value: string, txHash: string, isoDate: string, incoming = true): HistoryEventDto {
  return {
    timestamp: new Date(isoDate),
    eventType: HistoryEventType.TRANSFER,
    txHash,
    transfer: { from: incoming ? ZERO : BUYER_WALLET, to: incoming ? BUYER_WALLET : ZERO, value },
  } as HistoryEventDto;
}

const TX1 = '0xab12cd34ef567890ab12cd34ef567890ab12cd34ef567890ab12cd34ef561234';
const TX2 = '0x77aa88bb99cc00dd11ee22ff33445566778899aabbccddeeff0011223344abcd';
const TX3 = '0x55ffee44dd33cc22bb11aa00998877665544332211ffeeddccbbaa9988776655';

function expectValidPdf(base64: string): Buffer {
  const buf = Buffer.from(base64, 'base64');
  expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(buf.length).toBeGreaterThan(2000);
  return buf;
}

function writeExample(name: string, base64: string): void {
  if (process.env.GENERATE_RECEIPT_EXAMPLES !== 'true') return;
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, name), Buffer.from(base64, 'base64'));
}

describe('SwissQRService — RealUnit receipt examples', () => {
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

  it('renders a single-purchase receipt (DE)', async () => {
    const pdf = await service.createTxFromBlockchainReceipt(
      event('100', TX1, '2025-10-28T13:30:00Z'),
      buyer,
      REALU_ASSET,
      1.29,
      'CHF',
      true,
      PdfBrand.REALUNIT,
      'DE',
      BUYER_WALLET,
    );

    expectValidPdf(pdf);
    writeExample('single-de.pdf', pdf);
  });

  it('renders a single-purchase receipt (EN)', async () => {
    const pdf = await service.createTxFromBlockchainReceipt(
      event('100', TX1, '2025-10-28T13:30:00Z'),
      buyer,
      REALU_ASSET,
      1.29,
      'CHF',
      true,
      PdfBrand.REALUNIT,
      'EN',
      BUYER_WALLET,
    );

    expectValidPdf(pdf);
    writeExample('single-en.pdf', pdf);
  });

  it('renders a multi-transaction history receipt (DE)', async () => {
    const pdf = await service.createTxFromBlockchainMultiReceipt(
      [
        { historyEvent: event('100', TX1, '2025-10-28T13:30:00Z'), fiatPrice: 1.29, isIncoming: true },
        { historyEvent: event('250', TX2, '2025-11-15T09:05:00Z'), fiatPrice: 1.31, isIncoming: true },
        { historyEvent: event('50', TX3, '2026-01-10T16:45:00Z', false), fiatPrice: 1.34, isIncoming: false },
      ],
      buyer,
      REALU_ASSET,
      'CHF',
      PdfBrand.REALUNIT,
      'DE',
      BUYER_WALLET,
    );

    expectValidPdf(pdf);
    writeExample('multi-de.pdf', pdf);
  });
});
