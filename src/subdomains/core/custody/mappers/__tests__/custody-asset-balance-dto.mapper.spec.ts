import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { CustodyBalance } from '../../entities/custody-balance.entity';
import { CustodyAssetBalanceDtoMapper } from '../custody-asset-balance-dto.mapper';

describe('CustodyAssetBalanceDtoMapper', () => {
  describe('mapCustodyBalances', () => {
    it('sets interest and interestValue only for assets present in interestByAssetId', () => {
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
      const interestByAssetId = new Map<number, number>([[szchfAsset.id, interest]]);

      const result = CustodyAssetBalanceDtoMapper.mapCustodyBalances(balances, interestByAssetId);

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
  });
});
