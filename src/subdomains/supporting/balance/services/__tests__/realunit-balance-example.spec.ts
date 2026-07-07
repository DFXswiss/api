import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import { I18nModule, I18nService } from 'nestjs-i18n';
import * as path from 'path';
import { ConfigService, GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { extractPdfText } from 'src/shared/utils/__tests__/pdf-text.util';
import { PdfBrand } from 'src/shared/utils/pdf.util';
import { PriceCurrency } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { GetBalancePdfDto, PdfLanguage } from '../../dto/input/get-balance-pdf.dto';
import { BalancePdfService } from '../balance-pdf.service';

/**
 * Renders a real RealUnit portfolio statement ("Vermögensübersicht") straight from
 * {@link BalancePdfService} — the same code path the `POST /v1/realunit/balance/pdf` endpoint uses —
 * and validates the output is a well-formed PDF.
 *
 * The committed sample PDFs in `docs/examples/realunit-balance/` are produced by this test.
 * To regenerate them after a layout/i18n/valuation change, run:
 *
 *   GENERATE_RECEIPT_EXAMPLES=true npx jest realunit-balance-example
 *
 * Without the env flag the test only renders + asserts (no file writes), so it stays
 * deterministic in CI.
 */
const OUTPUT_DIR = path.join(process.cwd(), 'docs/examples/realunit-balance');

// A fixed example account holding 350 REALU — the two example purchases (100 + 250) that predate the
// 10.1.2026 sale in the receipt examples — reported on the 31.12.2025 record date. On that date REALU
// is valued at the official 2025 tax value (CHF 1.37), so the total is 350 × 1.37 = CHF 479.50.
const ADDRESS = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984';
const RECORD_DATE = new Date('2025-12-31T12:00:00Z');
const REALU_SHARES = 350;

const REALU = { id: 1, name: 'REALU', type: AssetType.TOKEN, chainId: '0xrealu', decimals: 18 } as unknown as Asset;
// A stray ZCHF dust balance on the same wallet; the statement must filter it out (only REALU shows).
const ZCHF = { id: 2, name: 'ZCHF', type: AssetType.TOKEN, chainId: '0xzchf', decimals: 18 } as unknown as Asset;

function toWei(shares: number): string {
  return (BigInt(shares) * 10n ** 18n).toString();
}

function writeExample(name: string, base64: string): void {
  if (process.env.GENERATE_RECEIPT_EXAMPLES !== 'true') return;
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, name), Buffer.from(base64, 'base64'));
}

describe('BalancePdfService — RealUnit portfolio-statement example', () => {
  let service: BalancePdfService;

  beforeAll(async () => {
    // Populate the global `Config` singleton (the RealUnit tax values live there) and wire up i18n.
    new ConfigService();

    const i18nConfig = GetConfig().i18n;
    const module = await Test.createTestingModule({
      imports: [I18nModule.forRoot({ ...i18nConfig, loaderOptions: { ...i18nConfig.loaderOptions, watch: false } })],
    }).compile();

    const alchemy = {
      findBlockByTimestamp: jest.fn().mockResolvedValue(1),
      getNativeCoinBalance: jest.fn().mockResolvedValue('0'),
      getTokenBalanceAtBlock: jest.fn().mockResolvedValue(toWei(REALU_SHARES)),
    };
    const assetService = { getAllBlockchainAssets: jest.fn().mockResolvedValue([REALU, ZCHF]) };
    // REALU is valued from the configured tax value, so the local-DB market price is never consulted for it.
    const assetPrices = { getAssetPriceForDate: jest.fn().mockResolvedValue(null) };
    const coinGecko = { getHistoricalPriceForAsset: jest.fn().mockResolvedValue(undefined) };

    service = new BalancePdfService(
      alchemy as never,
      assetService as never,
      assetPrices as never,
      coinGecko as never,
      module.get(I18nService),
    );
  });

  function render(language: PdfLanguage): Promise<string> {
    const dto = {
      address: ADDRESS,
      blockchain: Blockchain.ETHEREUM,
      currency: PriceCurrency.CHF,
      date: RECORD_DATE,
      language,
    } as GetBalancePdfDto;
    return service.generateBalancePdf(dto, PdfBrand.REALUNIT, (asset) => asset.id === REALU.id);
  }

  it('renders the portfolio statement (DE) — 350 REALU at the 2025 tax value', async () => {
    const pdf = await render(PdfLanguage.DE);

    expect(Buffer.from(pdf, 'base64').subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const text = extractPdfText(pdf);
    expect(text).toContain('REALU');
    expect(text).not.toContain('ZCHF'); // stray dust balance filtered out
    expect(text.toLowerCase()).not.toContain(ADDRESS.toLowerCase()); // raw address never printed
    expect(text).toContain('1.37'); // official 2025 tax value, not a market price
    expect(text).toContain('479.50'); // 350 × 1.37
    expect(text).toContain('2025-12-31'); // record date, no clock time
    expect(text).not.toMatch(/\b\d{1,2}:\d{2}\b/);
    expect(text).toContain('RealUnit Schweiz AG'); // issuer attribution
    expect(text).not.toContain('DFX');

    writeExample('balance-report-de.pdf', pdf);
  });

  it('renders the portfolio statement (EN)', async () => {
    const pdf = await render(PdfLanguage.EN);

    expect(Buffer.from(pdf, 'base64').subarray(0, 5).toString('latin1')).toBe('%PDF-');
    writeExample('balance-report-en.pdf', pdf);
  });
});
