import { Test } from '@nestjs/testing';
import { I18nModule, I18nService } from 'nestjs-i18n';
import * as zlib from 'zlib';
import { ConfigService, GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { PdfBrand } from 'src/shared/utils/pdf.util';
import { Util } from 'src/shared/utils/util';
import { PriceCurrency } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { GetBalancePdfDto, PdfLanguage } from '../../dto/input/get-balance-pdf.dto';
import { BalancePdfService } from '../balance-pdf.service';

// See realunit-receipt-example.spec.ts: inflate the FlateDecode content streams and decode the
// `[...] TJ` text runs so the tests can assert on the visible PDF text, not just that a PDF was made.
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

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const REALU = { id: 1, name: 'REALU', type: AssetType.TOKEN, chainId: '0xrealu', decimals: 18 } as unknown as Asset;
const ZCHF = { id: 2, name: 'ZCHF', type: AssetType.TOKEN, chainId: '0xzchf', decimals: 18 } as unknown as Asset;
const NATIVE = { id: 3, name: 'ETHER', type: AssetType.COIN, decimals: 18 } as unknown as Asset;

describe('BalancePdfService — RealUnit portfolio statement', () => {
  let text: string;

  beforeAll(async () => {
    // Populate the global `Config` singleton (normally wired up at app bootstrap) so i18n config resolves.
    new ConfigService();

    const i18nConfig = GetConfig().i18n;
    const module = await Test.createTestingModule({
      imports: [I18nModule.forRoot({ ...i18nConfig, loaderOptions: { ...i18nConfig.loaderOptions, watch: false } })],
    }).compile();

    const alchemy = {
      findBlockByTimestamp: jest.fn().mockResolvedValue(1),
      getNativeCoinBalance: jest.fn().mockResolvedValue('0'),
      // Every token reports a non-zero balance; only assets that survive the REALU filter are ever
      // queried, so a rendered ZCHF row would prove the filter failed.
      getTokenBalanceAtBlock: jest.fn().mockResolvedValue('1000000000000000000'),
    };
    const assetService = { getAllBlockchainAssets: jest.fn().mockResolvedValue([REALU, ZCHF, NATIVE]) };
    const assetPrices = {
      getAssetPriceForDate: jest.fn().mockResolvedValue({ priceChf: 1.36, priceEur: 1.4, priceUsd: 1.5 }),
    };
    const coinGecko = { getHistoricalPriceForAsset: jest.fn().mockResolvedValue(undefined) };

    const service = new BalancePdfService(
      alchemy as never,
      assetService as never,
      assetPrices as never,
      coinGecko as never,
      module.get(I18nService),
    );

    const dto = {
      address: ADDRESS,
      blockchain: Blockchain.ETHEREUM,
      currency: PriceCurrency.CHF,
      date: new Date('2026-07-01T00:00:00Z'),
      language: PdfLanguage.DE,
    } as GetBalancePdfDto;

    const pdf = await service.generateBalancePdf(dto, PdfBrand.REALUNIT, (asset) => asset.id === REALU.id);
    text = extractPdfText(pdf);
  });

  it('lists only REALU, never a ZCHF dust balance or any other asset', () => {
    expect(text).toContain('REALU');
    expect(text).not.toContain('ZCHF');
    expect(text).not.toContain('ETHER');
  });

  it('shows a short, non-reversible hash of the address instead of the raw wallet address', () => {
    const expectedHash = Util.createHash(ADDRESS).slice(0, 6).toUpperCase();
    expect(expectedHash).toHaveLength(6);
    expect(text).toContain(expectedHash);
    expect(text.toLowerCase()).not.toContain(ADDRESS.toLowerCase());
  });

  it('shows the date without a clock time', () => {
    expect(text).not.toMatch(/\b\d{1,2}:\d{2}\b/); // no HH:mm anywhere
    expect(text).not.toMatch(/T\d{2}:\d{2}/); // no ISO timestamp in the "generated by" footer
  });
});
