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
      // value is priced with the group representative (g[0].asset = szchfOtherChain, price 2),
      // NOT the interest-source asset (szchfEthereum, price 1) — the other half of the same
      // pricing guarantee: 1000 × 2 = 2000.
      expect(result[0].value).toEqual({ chf: 2000, eur: 2000, usd: 2000 });
      expect(result[0].interest).toBe(interest);
      expect(result[0].interestValue).toEqual({ chf: interest, eur: interest, usd: interest });
    });

    it('returns balances ordered by descending CHF value regardless of input order', () => {
      const aaaAsset: Asset = createCustomAsset({
        id: 20,
        name: 'AAA',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });
      const bbbAsset: Asset = createCustomAsset({
        id: 21,
        name: 'BBB',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });
      const cccAsset: Asset = createCustomAsset({
        id: 22,
        name: 'CCC',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });

      const balances: CustodyBalance[] = [
        Object.assign(new CustodyBalance(), { asset: cccAsset, balance: 50 }),
        Object.assign(new CustodyBalance(), { asset: aaaAsset, balance: 100 }),
        Object.assign(new CustodyBalance(), { asset: bbbAsset, balance: 500 }),
      ];
      const interestByAssetName = new Map<string, { interest: number; asset: Asset }>();

      const result = CustodyAssetBalanceDtoMapper.mapCustodyBalances(balances, interestByAssetName);

      expect(result.map((balance) => [balance.asset.name, balance.value.chf])).toEqual([
        ['BBB', 500],
        ['AAA', 100],
        ['CCC', 50],
      ]);
    });

    it('falls back to alphabetical asset name when CHF values are equal', () => {
      const aaaAsset: Asset = createCustomAsset({
        id: 30,
        name: 'AAA',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });
      const bbbAsset: Asset = createCustomAsset({
        id: 31,
        name: 'BBB',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });
      const cccAsset: Asset = createCustomAsset({
        id: 32,
        name: 'CCC',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });

      const balances: CustodyBalance[] = [
        Object.assign(new CustodyBalance(), { asset: cccAsset, balance: 100 }),
        Object.assign(new CustodyBalance(), { asset: bbbAsset, balance: 100 }),
        Object.assign(new CustodyBalance(), { asset: aaaAsset, balance: 100 }),
      ];
      const interestByAssetName = new Map<string, { interest: number; asset: Asset }>();

      const result = CustodyAssetBalanceDtoMapper.mapCustodyBalances(balances, interestByAssetName);

      expect(result.map((balance) => balance.asset.name)).toEqual(['AAA', 'BBB', 'CCC']);
    });

    it('returns the same order regardless of input order', () => {
      const aaaAsset: Asset = createCustomAsset({
        id: 40,
        name: 'AAA',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });
      const bbbAsset: Asset = createCustomAsset({
        id: 41,
        name: 'BBB',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });
      const cccAsset: Asset = createCustomAsset({
        id: 42,
        name: 'CCC',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });
      const dddAsset: Asset = createCustomAsset({
        id: 43,
        name: 'DDD',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });

      const balances: CustodyBalance[] = [
        Object.assign(new CustodyBalance(), { asset: bbbAsset, balance: 100 }),
        Object.assign(new CustodyBalance(), { asset: dddAsset, balance: 50 }),
        Object.assign(new CustodyBalance(), { asset: aaaAsset, balance: 200 }),
        Object.assign(new CustodyBalance(), { asset: cccAsset, balance: 100 }),
      ];
      const firstInterestByAssetName = new Map<string, { interest: number; asset: Asset }>();
      const secondInterestByAssetName = new Map<string, { interest: number; asset: Asset }>();

      const firstResult = CustodyAssetBalanceDtoMapper.mapCustodyBalances(balances, firstInterestByAssetName);
      const secondResult = CustodyAssetBalanceDtoMapper.mapCustodyBalances(
        [...balances].reverse(),
        secondInterestByAssetName,
      );

      expect(firstResult.map((balance) => balance.asset.name)).toEqual(
        secondResult.map((balance) => balance.asset.name),
      );
    });

    it('sorts negative CHF values after all positive values', () => {
      const aaaAsset: Asset = createCustomAsset({
        id: 50,
        name: 'AAA',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });
      const bbbAsset: Asset = createCustomAsset({
        id: 51,
        name: 'BBB',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });
      const cccAsset: Asset = createCustomAsset({
        id: 52,
        name: 'CCC',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });

      const balances: CustodyBalance[] = [
        Object.assign(new CustodyBalance(), { asset: aaaAsset, balance: -50 }),
        Object.assign(new CustodyBalance(), { asset: cccAsset, balance: 100 }),
        Object.assign(new CustodyBalance(), { asset: bbbAsset, balance: 500 }),
      ];
      const interestByAssetName = new Map<string, { interest: number; asset: Asset }>();

      const result = CustodyAssetBalanceDtoMapper.mapCustodyBalances(balances, interestByAssetName);

      expect(result.map((balance) => [balance.asset.name, balance.value.chf])).toEqual([
        ['BBB', 500],
        ['CCC', 100],
        ['AAA', -50],
      ]);
    });

    it('places a non-finite CHF value last regardless of input order', () => {
      const aaaAsset: Asset = createCustomAsset({
        id: 60,
        name: 'AAA',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });
      const bbbAsset: Asset = createCustomAsset({
        id: 61,
        name: 'BBB',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });
      const cccAsset: Asset = createCustomAsset({
        id: 62,
        name: 'CCC',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });

      const balances: CustodyBalance[] = [
        Object.assign(new CustodyBalance(), { asset: bbbAsset, balance: NaN }),
        Object.assign(new CustodyBalance(), { asset: cccAsset, balance: 100 }),
        Object.assign(new CustodyBalance(), { asset: aaaAsset, balance: 300 }),
      ];
      const firstInterestByAssetName = new Map<string, { interest: number; asset: Asset }>();
      const secondInterestByAssetName = new Map<string, { interest: number; asset: Asset }>();

      const firstResult = CustodyAssetBalanceDtoMapper.mapCustodyBalances(balances, firstInterestByAssetName);
      const secondResult = CustodyAssetBalanceDtoMapper.mapCustodyBalances(
        [...balances].reverse(),
        secondInterestByAssetName,
      );

      expect(firstResult.map((balance) => balance.asset.name)).toEqual(
        secondResult.map((balance) => balance.asset.name),
      );
      expect(firstResult[firstResult.length - 1].asset.name).toBe('BBB');
      expect(secondResult[secondResult.length - 1].asset.name).toBe('BBB');
      expect(firstResult[firstResult.length - 1].value.chf).toBeNaN();
      expect(secondResult[secondResult.length - 1].value.chf).toBeNaN();
    });
  });
});
