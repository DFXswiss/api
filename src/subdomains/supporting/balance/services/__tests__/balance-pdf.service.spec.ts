import { ConfigService } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { PriceCurrency } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { GetBalancePdfDto, PdfLanguage } from '../../dto/input/get-balance-pdf.dto';
import { BalanceData, BalancePdfService } from '../balance-pdf.service';

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const REALU = { id: 1, name: 'REALU', type: AssetType.TOKEN, chainId: '0xrealu', decimals: 18 } as unknown as Asset;
const ZCHF = { id: 2, name: 'ZCHF', type: AssetType.TOKEN, chainId: '0xzchf', decimals: 18 } as unknown as Asset;
const NATIVE = { id: 3, name: 'ETHER', type: AssetType.COIN, decimals: 18 } as unknown as Asset;

// Mocked local-DB market price (CHF); the official RealUnit tax value must take precedence over it.
const MARKET_PRICE_CHF = 1.36;

// The RealUnit portfolio statement is now rendered by SwissQRService.createBalanceStatement (see
// swiss-qr.service and the realunit-statement-example spec for the letter-layout assertions). This
// suite covers the shared data source both the DFX report and the RealUnit statement are built from:
// BalancePdfService.getBalanceData.
describe('BalancePdfService — getBalanceData (RealUnit share register)', () => {
  // Computes the priced balances for a wallet holding a single REALU share, filtered to REALU only.
  async function getData(date: Date): Promise<BalanceData> {
    // Populate the global `Config` singleton (normally wired up at app bootstrap) so the tax values resolve.
    new ConfigService();

    const alchemy = {
      findBlockByTimestamp: jest.fn().mockResolvedValue(1),
      // The native coin also reports a non-zero balance, so an ETHER entry would appear if the id filter
      // failed to drop the native coin — the assertion below then genuinely verifies its exclusion.
      getNativeCoinBalance: jest.fn().mockResolvedValue('1000000000000000000'),
      // Every token reports a non-zero balance; only assets that survive the REALU filter are ever
      // queried, so a ZCHF entry would prove the filter failed.
      getTokenBalanceAtBlock: jest.fn().mockResolvedValue('1000000000000000000'),
    };
    const assetService = { getAllBlockchainAssets: jest.fn().mockResolvedValue([REALU, ZCHF, NATIVE]) };
    const assetPrices = {
      getAssetPriceForDate: jest.fn().mockResolvedValue({ priceChf: MARKET_PRICE_CHF, priceEur: 1.4, priceUsd: 1.5 }),
    };
    const coinGecko = { getHistoricalPriceForAsset: jest.fn().mockResolvedValue(undefined) };

    const service = new BalancePdfService(
      alchemy as never,
      assetService as never,
      assetPrices as never,
      coinGecko as never,
      {} as never, // i18n is only used for rendering, never for getBalanceData
    );

    const dto = {
      address: ADDRESS,
      blockchain: Blockchain.ETHEREUM,
      currency: PriceCurrency.CHF,
      date,
      language: PdfLanguage.DE,
    } as GetBalancePdfDto;

    return service.getBalanceData(dto, (asset) => asset.id === REALU.id);
  }

  it('includes only REALU, never a ZCHF dust balance or the native coin', async () => {
    const { balances } = await getData(new Date('2025-12-31T00:00:00Z'));
    const names = balances.map((b) => b.asset.name);
    expect(names).toContain('REALU');
    expect(names).not.toContain('ZCHF');
    expect(names).not.toContain('ETHER');
  });

  it('values REALU at the official yearly tax value, overriding the market price', async () => {
    // 2025 tax value is CHF 1.37 and must take precedence over the mocked local-DB market price (1.36).
    const { balances, totalValue, hasIncompleteData } = await getData(new Date('2025-12-31T00:00:00Z'));
    const realu = balances.find((b) => b.asset.name === 'REALU');
    expect(realu?.price).toBe(1.37);
    expect(realu?.price).not.toBe(MARKET_PRICE_CHF);
    // one share held (1e18 wei / 1e18) → value equals the unit price
    expect(realu?.value).toBe(1.37);
    expect(totalValue).toBe(1.37);
    expect(hasIncompleteData).toBe(false);
  });

  it('reports incomplete data (no value) for a year without a configured tax value', async () => {
    const { balances, totalValue, hasIncompleteData } = await getData(new Date('2020-12-31T00:00:00Z'));
    const realu = balances.find((b) => b.asset.name === 'REALU');
    expect(realu).toBeDefined();
    // never falls back to the market price for an uncovered year
    expect(realu?.price).toBeUndefined();
    expect(realu?.value).toBeUndefined();
    expect(hasIncompleteData).toBe(true);
    expect(totalValue).toBe(0);
  });
});
