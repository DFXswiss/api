import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { CustodyBalance } from '../../entities/custody-balance.entity';
import { CustodyAssetBalanceDtoMapper } from '../custody-asset-balance-dto.mapper';

describe('CustodyAssetBalanceDtoMapper', () => {
  describe('mapCustodyBalances', () => {
    it('sets interest and interestValue only for assets present in interestByAssetName', () => {
      const szchfAsset = createCustomAsset({
        id: 1,
        name: 'sZCHF',
        description: 'Saving ZCHF',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });
      const btcAsset = createCustomAsset({
        id: 2,
        name: 'BTC',
        description: 'Bitcoin',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });

      const balances = [
        Object.assign(new CustodyBalance(), { asset: szchfAsset, balance: 1000 }),
        Object.assign(new CustodyBalance(), { asset: btcAsset, balance: 2 }),
      ];

      // Two decimals so FIAT roundReadable leaves the value unchanged (same as convert at price 1).
      const interest = 12.34;
      const interestByAssetName = new Map<string, number>([[szchfAsset.name, interest]]);

      const result = CustodyAssetBalanceDtoMapper.mapCustodyBalances(balances, interestByAssetName);

      const szchfDto = result.find((b) => b.asset.name === 'sZCHF');
      const btcDto = result.find((b) => b.asset.name === 'BTC');

      expect(szchfDto).toBeDefined();
      expect(btcDto).toBeDefined();

      expect(szchfDto.interest).toBe(interest);
      expect(szchfDto.interestValue).toEqual({
        eur: interest,
        chf: interest,
        usd: interest,
      });
      expect(szchfDto.interestValue.chf).toBe(szchfDto.interest);
      expect(szchfDto.interestValue.eur).toBe(szchfDto.interest);
      expect(szchfDto.interestValue.usd).toBe(szchfDto.interest);

      expect(btcDto.interest).toBeUndefined();
      expect(btcDto.interestValue).toBeUndefined();
    });

    it('attaches interest by asset.name, not array position, for same-named assets', () => {
      const szchfEthereum = createCustomAsset({
        id: 10,
        name: 'sZCHF',
        uniqueName: 'Ethereum/sZCHF',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });
      const szchfOtherChain = createCustomAsset({
        id: 11,
        name: 'sZCHF',
        uniqueName: 'Citrea/sZCHF',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });

      // The non-Ethereum sZCHF balance is listed first — Util.groupByAccessor groups by
      // asset.name, so the group's representative (g[0].asset) is szchfOtherChain, not the
      // interest-bearing one. A lookup keyed by asset.id would miss the interest here; keyed
      // by asset.name (the same identity the grouping itself uses) it still matches.
      const balances = [
        Object.assign(new CustodyBalance(), { asset: szchfOtherChain, balance: 200 }),
        Object.assign(new CustodyBalance(), { asset: szchfEthereum, balance: 800 }),
      ];

      const interest = 12.34;
      const interestByAssetName = new Map<string, number>([['sZCHF', interest]]);

      const result = CustodyAssetBalanceDtoMapper.mapCustodyBalances(balances, interestByAssetName);

      expect(result).toHaveLength(1);
      expect(result[0].asset.name).toBe('sZCHF');
      expect(result[0].balance).toBe(1000);
      expect(result[0].interest).toBe(interest);
      expect(result[0].interestValue).toEqual({ chf: interest, eur: interest, usd: interest });
    });
  });
});
