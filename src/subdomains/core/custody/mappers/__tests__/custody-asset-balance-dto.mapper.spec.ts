import { Asset } from 'src/shared/models/asset/asset.entity';
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
      const interestByAssetName = new Map<string, { interest: number; asset: Asset }>([
        [szchfAsset.name, { interest, asset: szchfAsset }],
      ]);

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

    it('prices interestValue with the interest-source asset, not the same-named group representative', () => {
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
        approxPriceChf: 2,
        approxPriceEur: 2,
        approxPriceUsd: 2,
      });

      // The non-Ethereum sZCHF balance is listed first (becomes g[0], the group representative
      // used for `value`/`balance`) AND has a different price. If interestValue were priced off
      // g[0].asset instead of the asset the interest actually accrued on, it would silently come
      // out double (price 2 instead of 1).
      const balances = [
        Object.assign(new CustodyBalance(), { asset: szchfOtherChain, balance: 200 }),
        Object.assign(new CustodyBalance(), { asset: szchfEthereum, balance: 800 }),
      ];

      const interest = 12.34;
      const interestByAssetName = new Map<string, { interest: number; asset: Asset }>([
        ['sZCHF', { interest, asset: szchfEthereum }],
      ]);

      const result = CustodyAssetBalanceDtoMapper.mapCustodyBalances(balances, interestByAssetName);

      expect(result).toHaveLength(1);
      expect(result[0].asset.name).toBe('sZCHF');
      expect(result[0].balance).toBe(1000);
      expect(result[0].interest).toBe(interest);
      expect(result[0].interestValue).toEqual({ chf: interest, eur: interest, usd: interest });
    });
  });
});
