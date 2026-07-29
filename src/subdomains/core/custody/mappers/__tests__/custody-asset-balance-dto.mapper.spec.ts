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

      // balance/value now carry the booked amount plus the accrued interest — the fold this PR
      // introduces. interest/interestValue above stay a breakdown of what is already in here.
      expect(szchfDto.balance).toBeCloseTo(1000 + interest, 8);
      expect(szchfDto.value).toEqual({
        eur: expect.closeTo(1000 + interest, 8),
        chf: expect.closeTo(1000 + interest, 8),
        usd: expect.closeTo(1000 + interest, 8),
      });

      // A position with no interestByAssetName entry is unaffected — plain booked balance/value,
      // exactly the pre-fix behaviour.
      expect(btcDto.interest).toBeUndefined();
      expect(btcDto.interestValue).toBeUndefined();
      expect(btcDto.balance).toBe(2);
      expect(btcDto.value).toEqual({ eur: 2, chf: 2, usd: 2 });
    });

    it("prices each source asset's own line independently, so interest is valued at its own asset's price, not the group representative's price", () => {
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

      // The non-Ethereum sZCHF balance is listed first (becomes g[0], the display representative)
      // AND has a different price. Each source asset must be priced with its own rate: 200 at
      // price 2 plus (800 + interest) at price 1. Pricing the whole name group with g[0].asset
      // would silently value the interest (and the Ethereum holdings) at price 2.
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
      expect(result[0].balance).toBeCloseTo(1012.34, 8);
      // Per-source pricing: 200 × 2 + (800 + 12.34) × 1 = 1212.34. The old group-representative
      // path would have produced (1000 + 12.34) × 2 = 2024.68.
      expect(result[0].value).toEqual({
        chf: expect.closeTo(1212.34, 2),
        eur: expect.closeTo(1212.34, 2),
        usd: expect.closeTo(1212.34, 2),
      });
      expect(result[0].interest).toBe(interest);
      expect(result[0].interestValue).toEqual({ chf: interest, eur: interest, usd: interest });
    });

    it('adds interest only once per source asset when multiple balance rows share the same asset id', () => {
      const szchfAsset = createCustomAsset({
        id: 10,
        name: 'sZCHF',
        uniqueName: 'Ethereum/sZCHF',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });

      // Two custody users on the same chain share one asset id. Interest is computed once across
      // all users of that asset, so it must be folded once into the id-group total — not once per
      // raw balance row.
      const balances = [
        Object.assign(new CustodyBalance(), { asset: szchfAsset, balance: 300 }),
        Object.assign(new CustodyBalance(), { asset: szchfAsset, balance: 500 }),
      ];

      const interest = 12.34;
      const interestByAssetName = new Map<string, { interest: number; asset: Asset }>([
        ['sZCHF', { interest, asset: szchfAsset }],
      ]);

      const result = CustodyAssetBalanceDtoMapper.mapCustodyBalances(balances, interestByAssetName);

      expect(result).toHaveLength(1);
      expect(result[0].balance).toBeCloseTo(812.34, 8);
      expect(result[0].value).toEqual({
        chf: expect.closeTo(812.34, 2),
        eur: expect.closeTo(812.34, 2),
        usd: expect.closeTo(812.34, 2),
      });
      // Regression guard: adding interest once per row would yield 300 + 500 + 12.34 + 12.34.
      expect(result[0].value.chf).not.toBeCloseTo(824.68, 2);
      expect(result[0].interest).toBe(interest);
      expect(result[0].interestValue).toEqual({ chf: interest, eur: interest, usd: interest });
    });

    it('matches the old group-representative value when same-named chain assets share the same price', () => {
      const szchfEthereum = createCustomAsset({
        id: 10,
        name: 'sZCHF',
        uniqueName: 'Ethereum/sZCHF',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });
      const szchfCitrea = createCustomAsset({
        id: 11,
        name: 'sZCHF',
        uniqueName: 'Citrea/sZCHF',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });

      const interest = 12.34;
      const interestByAssetName = new Map<string, { interest: number; asset: Asset }>([
        ['sZCHF', { interest, asset: szchfEthereum }],
      ]);

      const balancesForward = [
        Object.assign(new CustodyBalance(), { asset: szchfEthereum, balance: 300 }),
        Object.assign(new CustodyBalance(), { asset: szchfCitrea, balance: 700 }),
      ];
      const balancesReversed = [
        Object.assign(new CustodyBalance(), { asset: szchfCitrea, balance: 700 }),
        Object.assign(new CustodyBalance(), { asset: szchfEthereum, balance: 300 }),
      ];

      const forward = CustodyAssetBalanceDtoMapper.mapCustodyBalances(balancesForward, interestByAssetName);
      const reversed = CustodyAssetBalanceDtoMapper.mapCustodyBalances(balancesReversed, interestByAssetName);

      // Same prices across chains: per-source pricing equals the old name-group representative path
      // (1000 + 12.34) × 1, independent of input order.
      for (const result of [forward, reversed]) {
        expect(result).toHaveLength(1);
        expect(result[0].balance).toBeCloseTo(1012.34, 8);
        expect(result[0].value).toEqual({
          chf: expect.closeTo(1012.34, 2),
          eur: expect.closeTo(1012.34, 2),
          usd: expect.closeTo(1012.34, 2),
        });
        expect(result[0].interest).toBe(interest);
        expect(result[0].interestValue).toEqual({ chf: interest, eur: interest, usd: interest });
      }
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
      const dddAsset: Asset = createCustomAsset({
        id: 62,
        name: 'DDD',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });
      const cccAsset: Asset = createCustomAsset({
        id: 63,
        name: 'CCC',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });

      // NaN plus two positive values is not enough: the old raw-value comparator and the ranked
      // comparator happen to return the same order for both forward and reversed input, so the
      // order-stability assertion cannot catch a regression. This four-value set adds a negative
      // value: the old comparator returns BBB, CCC, DDD, AAA forward and BBB, AAA, CCC, DDD
      // reversed, while the ranked comparator returns BBB, DDD, AAA, CCC both ways. Collapsing
      // this back to three entries silently removes the only thing this test checks, so it must
      // not be "simplified" later.
      const balances: CustodyBalance[] = [
        Object.assign(new CustodyBalance(), { asset: aaaAsset, balance: -5 }),
        Object.assign(new CustodyBalance(), { asset: bbbAsset, balance: 10 }),
        Object.assign(new CustodyBalance(), { asset: dddAsset, balance: 0 }),
        Object.assign(new CustodyBalance(), { asset: cccAsset, balance: NaN }),
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
      expect(firstResult[firstResult.length - 1].asset.name).toBe('CCC');
      expect(secondResult[secondResult.length - 1].asset.name).toBe('CCC');
      expect(firstResult[firstResult.length - 1].value.chf).toBeNaN();
      expect(secondResult[secondResult.length - 1].value.chf).toBeNaN();
    });

    it('places a positive Infinity CHF value last, the same as a non-finite NaN value', () => {
      const cccAsset: Asset = createCustomAsset({
        id: 70,
        name: 'CCC',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });
      const aaaAsset: Asset = createCustomAsset({
        id: 71,
        name: 'AAA',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });
      const bbbAsset: Asset = createCustomAsset({
        id: 72,
        name: 'BBB',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });

      // Infinity is distinct from NaN because it is ordinarily comparable: the old raw-value
      // comparator sorts it first instead of scrambling the order, so the position assertions
      // catch the regression here. The order-stability assertion remains for consistency even
      // though it does not distinguish the old and ranked comparators for this dataset.
      const balances: CustodyBalance[] = [
        Object.assign(new CustodyBalance(), { asset: cccAsset, balance: Infinity }),
        Object.assign(new CustodyBalance(), { asset: aaaAsset, balance: 200 }),
        Object.assign(new CustodyBalance(), { asset: bbbAsset, balance: 100 }),
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
      expect(firstResult[firstResult.length - 1].asset.name).toBe('CCC');
      expect(secondResult[secondResult.length - 1].asset.name).toBe('CCC');
      expect(firstResult[firstResult.length - 1].value.chf).toBe(Infinity);
      expect(secondResult[secondResult.length - 1].value.chf).toBe(Infinity);
    });

    it('throws when interest targets no asset id in the matching balance name group', () => {
      const balanceAsset = createCustomAsset({
        id: 10,
        name: 'sZCHF',
        uniqueName: 'Ethereum/sZCHF',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });
      const unmatchedInterestAsset = createCustomAsset({
        id: 99,
        name: 'sZCHF',
        uniqueName: 'Citrea/sZCHF',
        approxPriceChf: 1,
        approxPriceEur: 1,
        approxPriceUsd: 1,
      });

      const balances = [Object.assign(new CustodyBalance(), { asset: balanceAsset, balance: 1000 })];
      const interestByAssetName = new Map<string, { interest: number; asset: Asset }>([
        ['sZCHF', { interest: 12.34, asset: unmatchedInterestAsset }],
      ]);

      // The current custody service builds interestByAssetName from assets represented by the
      // balances it is processing, so its present call path normally cannot create this mismatch.
      // The mapper's contract is independent of that caller, however: a future caller can supply
      // an interest asset with the right name but an id absent from the name group. The guard must
      // reject that input because otherwise interest would increase balance without contributing
      // to the value of any priced asset sub-group.
      const mapBalances = () => CustodyAssetBalanceDtoMapper.mapCustodyBalances(balances, interestByAssetName);

      expect(mapBalances).toThrow(/has no matching balance sub-group/);
      expect(mapBalances).toThrow(/Citrea\/sZCHF/);
      expect(mapBalances).toThrow(/\(id 99\)/);
      expect(mapBalances).toThrow(/name group 'sZCHF'/);
    });
  });
});
