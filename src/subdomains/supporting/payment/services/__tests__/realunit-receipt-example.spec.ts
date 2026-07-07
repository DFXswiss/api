import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import { I18nModule, I18nService } from 'nestjs-i18n';
import * as path from 'path';
import * as zlib from 'zlib';
import { ConfigService, GetConfig } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PdfBrand } from 'src/shared/utils/pdf.util';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { HistoryEventType } from 'src/subdomains/supporting/realunit/dto/client.dto';
import { HistoryEventDto } from 'src/subdomains/supporting/realunit/dto/realunit.dto';
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
// An ordinary counterparty wallet — neither the mint/zero address nor the Brokerbot contract, so a
// transfer to/from it is NOT a trade and must render the neutral "Transfer" layout.
const OTHER_WALLET = '0x00000000219ab540356cBB839Cbe05303d7705Fa';

const buyer = {
  completeName: 'Max Mustermann',
  isInvoiceDataComplete: true,
  language: { symbol: 'DE' },
  address: { street: 'Musterstrasse', houseNumber: '12', zip: '8002', city: 'Zürich', country: { symbol: 'CH' } },
} as unknown as UserData;

// Trade event: a buy is minted from the zero address; a sell is a REALU swap sent to the on-chain
// Brokerbot contract (both DFX-mediated and direct sells settle REALU<->ZCHF via the Brokerbot, so the
// sell receipt states an on-chain settlement rather than a bank payout).
function event(value: string, txHash: string, isoDate: string, incoming = true): HistoryEventDto {
  const brokerbot = GetConfig().blockchain.realunit.brokerbotAddress;
  return {
    timestamp: new Date(isoDate),
    eventType: HistoryEventType.TRANSFER,
    txHash,
    transfer: { from: incoming ? ZERO : BUYER_WALLET, to: incoming ? BUYER_WALLET : brokerbot, value },
  } as HistoryEventDto;
}

// Plain wallet-to-wallet transfer (no fiat leg): received from an ordinary wallet.
function transferEvent(value: string, txHash: string, isoDate: string): HistoryEventDto {
  return {
    timestamp: new Date(isoDate),
    eventType: HistoryEventType.TRANSFER,
    txHash,
    transfer: { from: OTHER_WALLET, to: BUYER_WALLET, value },
  } as HistoryEventDto;
}

const TX1 = '0xab12cd34ef567890ab12cd34ef567890ab12cd34ef567890ab12cd34ef561234';
const TX2 = '0x77aa88bb99cc00dd11ee22ff33445566778899aabbccddeeff0011223344abcd';
const TX3 = '0x55ffee44dd33cc22bb11aa00998877665544332211ffeeddccbbaa9988776655';
const TX4 = '0x1122334455667788990011223344556677889900112233445566778899001122';

function expectValidPdf(base64: string): Buffer {
  const buf = Buffer.from(base64, 'base64');
  expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(buf.length).toBeGreaterThan(2000);
  return buf;
}

// German receipt labels, read from the shipped i18n so the content assertions track the real
// rendered strings instead of hard-coded duplicates.
const DE = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/shared/i18n/de/invoice.json'), 'utf8'));
const DE_RECEIPT = DE.realunit_receipt as Record<string, string>;

// Extracts the visible text of a PDFKit-rendered PDF so the tests can assert on the actual receipt
// content, not merely that a PDF was produced. PDFKit emits each text run as WinAnsi hex bytes inside
// a `[...] TJ` array; we inflate the FlateDecode content streams and decode those bytes. Characters
// outside Latin-1 (e.g. the em dash) are irrelevant to anything asserted here.
function extractPdfText(base64: string): string {
  const buf = Buffer.from(base64, 'base64');
  const runs: string[] = [];
  let idx = 0;
  while (true) {
    const start = buf.indexOf('stream', idx, 'latin1');
    if (start === -1) break;
    if (buf.toString('latin1', start - 3, start) === 'end') {
      idx = start + 6;
      continue;
    }
    let dataStart = start + 6;
    if (buf[dataStart] === 0x0d && buf[dataStart + 1] === 0x0a) dataStart += 2;
    else if (buf[dataStart] === 0x0a) dataStart += 1;
    const end = buf.indexOf('endstream', dataStart, 'latin1');
    if (end === -1) break;
    idx = end + 9;

    let content: string;
    try {
      content = zlib.inflateSync(buf.subarray(dataStart, end)).toString('latin1');
    } catch {
      continue; // not a FlateDecode stream (e.g. the embedded logo image)
    }
    if (!content.includes('BT')) continue;

    const tjArray = /\[([^\]]*)\]\s*TJ/g;
    let match: RegExpExecArray | null;
    while ((match = tjArray.exec(content))) {
      const hexParts = match[1].match(/<([0-9A-Fa-f]*)>/g) ?? [];
      runs.push(hexParts.map((part) => Buffer.from(part.slice(1, -1), 'hex').toString('latin1')).join(''));
    }
  }
  return runs.join('\n');
}

// A receipt is a customer tax document: it must never leak the wallet address or a tx hash.
function expectNoWalletOrTxHash(text: string): void {
  const lower = text.toLowerCase();
  for (const secret of [BUYER_WALLET, OTHER_WALLET, ZERO, TX1, TX2, TX3, TX4]) {
    expect(lower).not.toContain(secret.toLowerCase());
  }
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

  it('renders the transaction confirmation (DE)', async () => {
    const pdf = await service.createTxFromBlockchainReceipt(
      event('100', TX1, '2025-10-28T13:30:00Z'),
      buyer,
      REALU_ASSET,
      1.29,
      'CHF',
      true,
      PdfBrand.REALUNIT,
      'DE',
    );

    expectValidPdf(pdf);
    const text = extractPdfText(pdf);
    // Bank-settled DFX buy (minted from the zero address): states a purchase paid by bank transfer.
    expect(text).toContain(DE_RECEIPT.type_buy); // Kauf
    expect(text).toContain(DE_RECEIPT.payment_method_bank); // Banküberweisung
    expect(text).not.toContain(DE_RECEIPT.payment_method_on_chain);
    expectNoWalletOrTxHash(text);
    writeExample('transaction-confirmation-de.pdf', pdf);
  });

  it('renders the transaction confirmation (EN)', async () => {
    const pdf = await service.createTxFromBlockchainReceipt(
      event('100', TX1, '2025-10-28T13:30:00Z'),
      buyer,
      REALU_ASSET,
      1.29,
      'CHF',
      true,
      PdfBrand.REALUNIT,
      'EN',
    );

    expectValidPdf(pdf);
    writeExample('transaction-confirmation-en.pdf', pdf);
  });

  it('renders the sale confirmation (DE)', async () => {
    const pdf = await service.createTxFromBlockchainReceipt(
      event('50', TX3, '2026-01-10T16:45:00Z', false),
      buyer,
      REALU_ASSET,
      1.34,
      'CHF',
      false,
      PdfBrand.REALUNIT,
      'DE',
    );

    expectValidPdf(pdf);
    const text = extractPdfText(pdf);
    // On-chain Brokerbot sell: states a sale settled on-chain (ZCHF), never a bank payout.
    expect(text).toContain(DE_RECEIPT.type_sell); // Verkauf
    expect(text).toContain(DE_RECEIPT.payment_method_on_chain); // On-Chain abgewickelt (ZCHF)
    expect(text).not.toContain(DE_RECEIPT.payment_method_bank);
    expectNoWalletOrTxHash(text);
    writeExample('transaction-confirmation-sale-de.pdf', pdf);
  });

  it('renders a plain transfer without a purchase/payment claim (DE)', async () => {
    const pdf = await service.createTxFromBlockchainReceipt(
      transferEvent('30', TX4, '2026-02-01T10:00:00Z'),
      buyer,
      REALU_ASSET,
      1.36,
      'CHF',
      true,
      PdfBrand.REALUNIT,
      'DE',
    );

    expectValidPdf(pdf);
    const text = extractPdfText(pdf);
    // Plain wallet-to-wallet transfer (no fiat leg): neutral "Transfer" type, no purchase/sale and no
    // payment-method row at all.
    expect(text).toContain(DE_RECEIPT.type_transfer); // Übertragung
    expect(text).not.toContain(DE_RECEIPT.payment_method_label); // no "Zahlungsweg" row
    expect(text).not.toContain(DE_RECEIPT.payment_method_bank);
    expect(text).not.toContain(DE_RECEIPT.payment_method_on_chain);
    expect(text).not.toContain(DE_RECEIPT.type_buy);
    expect(text).not.toContain(DE_RECEIPT.type_sell);
    expectNoWalletOrTxHash(text);
    writeExample('transaction-transfer-de.pdf', pdf);
  });

  it('renders the transaction history (DE)', async () => {
    const pdf = await service.createTxFromBlockchainMultiReceipt(
      [
        { historyEvent: event('100', TX1, '2025-10-28T13:30:00Z'), fiatPrice: 1.29, isIncoming: true },
        { historyEvent: event('250', TX2, '2025-11-15T09:05:00Z'), fiatPrice: 1.31, isIncoming: true },
        { historyEvent: event('50', TX3, '2026-01-10T16:45:00Z', false), fiatPrice: 1.34, isIncoming: false },
        { historyEvent: transferEvent('30', TX4, '2026-02-01T10:00:00Z'), fiatPrice: 1.36, isIncoming: true },
      ],
      buyer,
      REALU_ASSET,
      'CHF',
      PdfBrand.REALUNIT,
      'DE',
    );

    expectValidPdf(pdf);
    const text = extractPdfText(pdf);
    // Mixed history: the buy section claims bank settlement, the sell section on-chain, and the plain
    // transfer lands in its own neutral section — each per-section claim stays correct.
    expect(text).toContain(DE.section.buy); // Käufe
    expect(text).toContain(DE.section.sell); // Verkäufe
    expect(text).toContain(DE.section.transfer); // Übertragungen
    expect(text).toContain(DE_RECEIPT.payment_method_bank); // Banküberweisung (buy section)
    expect(text).toContain(DE_RECEIPT.payment_method_on_chain); // on-chain (sell section)
    expectNoWalletOrTxHash(text);
    writeExample('transaction-history-de.pdf', pdf);
  });

  it('renders the transaction history (EN)', async () => {
    const pdf = await service.createTxFromBlockchainMultiReceipt(
      [
        { historyEvent: event('100', TX1, '2025-10-28T13:30:00Z'), fiatPrice: 1.29, isIncoming: true },
        { historyEvent: event('250', TX2, '2025-11-15T09:05:00Z'), fiatPrice: 1.31, isIncoming: true },
        { historyEvent: event('50', TX3, '2026-01-10T16:45:00Z', false), fiatPrice: 1.34, isIncoming: false },
        { historyEvent: transferEvent('30', TX4, '2026-02-01T10:00:00Z'), fiatPrice: 1.36, isIncoming: true },
      ],
      buyer,
      REALU_ASSET,
      'CHF',
      PdfBrand.REALUNIT,
      'EN',
    );

    expectValidPdf(pdf);
    writeExample('transaction-history-en.pdf', pdf);
  });

  // Guards against a missing/typo'd i18n key silently printing the raw key on a customer tax
  // document: every receipt label must exist in every supported language.
  it('has every receipt i18n key in all supported languages', () => {
    const receiptKeys = [
      'realunit_receipt.buy_description',
      'realunit_receipt.sell_description',
      'realunit_receipt.unit_price_label',
      'realunit_receipt.fees_label',
      'realunit_receipt.fees_free',
      'realunit_receipt.details_title',
      'realunit_receipt.buyer_label',
      'realunit_receipt.receipt_total_label',
      'realunit_receipt.transaction_type_label',
      'realunit_receipt.type_buy',
      'realunit_receipt.type_sell',
      'realunit_receipt.type_transfer',
      'realunit_receipt.payment_method_label',
      'realunit_receipt.payment_method_bank',
      'realunit_receipt.payment_method_on_chain',
      'section.buy',
      'section.sell',
      'section.transfer',
    ];

    const missing: string[] = [];
    for (const lang of ['de', 'en', 'fr', 'it']) {
      const invoice = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), 'src/shared/i18n', lang, 'invoice.json'), 'utf8'),
      );
      for (const key of receiptKeys) {
        const value = key.split('.').reduce<any>((node, part) => node?.[part], invoice);
        if (typeof value !== 'string' || value.length === 0) missing.push(`${lang}: invoice.${key}`);
      }
    }

    expect(missing).toEqual([]);
  });
});
