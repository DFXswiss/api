import { PARTNER_STATISTIC_SUPPRESSION_THRESHOLD } from '../partner-statistic.enum';
import {
  isUnderThreshold,
  suppressAllTimeVolume,
  suppressBreakdownRows,
  suppressPeriodTotals,
  suppressScalar,
  suppressTimelineBuckets,
} from '../partner-statistic.suppression';

/** Single calendar anchor for payload dates — suppression logic is count-based, not calendar-based. */
const TEST_BUCKET_DATE = new Date();

describe('Partner statistic suppression', () => {
  describe('suppressScalar (M1)', () => {
    it('keeps 0 as 0 and nulls only 1..k-1 (boundary is strict < k)', () => {
      expect(suppressScalar(0)).toBe(0);
      expect(suppressScalar(1)).toBeNull();
      expect(suppressScalar(4)).toBeNull();
      expect(suppressScalar(PARTNER_STATISTIC_SUPPRESSION_THRESHOLD - 1)).toBeNull();
      expect(suppressScalar(PARTNER_STATISTIC_SUPPRESSION_THRESHOLD)).toBe(5);
      expect(suppressScalar(5)).toBe(5);
      expect(suppressScalar(10)).toBe(10);
      expect(suppressScalar(PARTNER_STATISTIC_SUPPRESSION_THRESHOLD - 1)).not.toBe(
        PARTNER_STATISTIC_SUPPRESSION_THRESHOLD - 1,
      );
      expect(suppressScalar(PARTNER_STATISTIC_SUPPRESSION_THRESHOLD)).not.toBeNull();
    });

    it('uses min(transactions, users) as the effective count (person gate)', () => {
      // 10 txs but only 3 users → under k
      expect(suppressScalar(10, undefined, 3)).toBeNull();
      // 10 txs and 5 users → visible
      expect(suppressScalar(10, undefined, 5)).toBe(10);
      // 3 txs and 10 users → under k on tx side
      expect(suppressScalar(3, undefined, 10)).toBeNull();
    });

    it('respects an explicit custom threshold', () => {
      expect(suppressScalar(3, 3)).toBe(3);
      expect(suppressScalar(2, 3)).toBeNull();
      expect(suppressScalar(3, 10, 3)).toBeNull();
    });

    it('isUnderThreshold uses the module default k when threshold is omitted', () => {
      expect(isUnderThreshold(PARTNER_STATISTIC_SUPPRESSION_THRESHOLD - 1)).toBe(true);
      expect(isUnderThreshold(PARTNER_STATISTIC_SUPPRESSION_THRESHOLD)).toBe(false);
      expect(isUnderThreshold(0)).toBe(false);
    });
  });

  describe('suppressBreakdownRows', () => {
    it('drops rows with fewer than k transactions (boundary at k)', () => {
      const { rows, suppressedCount } = suppressBreakdownRows([
        { name: 'A', volume: 100, transactions: 4 },
        { name: 'B', volume: 50, transactions: 3 },
        { name: 'C', volume: 200, transactions: 5 },
        { name: 'D', volume: 300, transactions: 10 },
      ]);

      expect(rows.map((r) => r.name).sort()).toEqual(['C', 'D']);
      expect(suppressedCount).toBe(2);
      expect(rows.find((r) => r.name === 'C')?.transactions).toBe(5);
      expect(rows.some((r) => r.transactions === PARTNER_STATISTIC_SUPPRESSION_THRESHOLD)).toBe(true);
    });

    it('drops rows when person count is under k even if transactions are above k', () => {
      const { rows, suppressedCount } = suppressBreakdownRows([
        { name: 'A', volume: 100, transactions: 20, users: 2 },
        { name: 'B', volume: 200, transactions: 20, users: 10 },
        { name: 'C', volume: 300, transactions: 30, users: 15 },
      ]);
      // A under k on person gate; complementary drops B (smallest remaining); C stays
      expect(rows.map((r) => r.name)).toEqual(['C']);
      expect(suppressedCount).toBe(2);
      expect(rows.find((r) => r.name === 'A')).toBeUndefined();
    });

    it('applies complementary suppression only when exactly one row is under threshold', () => {
      const { rows, suppressedCount } = suppressBreakdownRows([
        { name: 'A', volume: 10, transactions: 3 },
        { name: 'B', volume: 20, transactions: 6 },
        { name: 'C', volume: 100, transactions: 50 },
      ]);

      expect(rows.map((r) => r.name)).toEqual(['C']);
      expect(suppressedCount).toBe(2);
      expect(rows.find((r) => r.name === 'B')).toBeUndefined();
    });

    it('picks the later smaller filled row when complementary reduces across candidates', () => {
      // First remaining filled is larger than the second — reduce must take the `b` arm.
      const { rows, suppressedCount } = suppressBreakdownRows([
        { name: 'A', volume: 10, transactions: 3 },
        { name: 'B', volume: 100, transactions: 50 },
        { name: 'C', volume: 20, transactions: 6 },
      ]);
      expect(rows.map((r) => r.name)).toEqual(['B']);
      expect(suppressedCount).toBe(2);
      expect(rows.find((r) => r.name === 'C')).toBeUndefined();
    });

    it('does not apply complementary suppression when zero or two+ rows are under threshold', () => {
      const none = suppressBreakdownRows([
        { name: 'A', volume: 10, transactions: 5 },
        { name: 'B', volume: 20, transactions: 6 },
      ]);
      expect(none.rows).toHaveLength(2);
      expect(none.suppressedCount).toBe(0);

      const two = suppressBreakdownRows([
        { name: 'A', volume: 10, transactions: 2 },
        { name: 'B', volume: 20, transactions: 3 },
        { name: 'C', volume: 100, transactions: 50 },
      ]);
      expect(two.rows.map((r) => r.name)).toEqual(['C']);
      expect(two.suppressedCount).toBe(2);
      expect(two.rows).toHaveLength(1);
    });

    it('skips complementary when only zero-tx rows remain after dropping one under-k row', () => {
      const { rows, suppressedCount } = suppressBreakdownRows([
        { name: 'A', volume: 10, transactions: 3 },
        { name: 'B', volume: 0, transactions: 0 },
      ]);
      expect(rows.map((r) => r.name)).toEqual(['B']);
      expect(suppressedCount).toBe(1);
    });
  });

  describe('suppressTimelineBuckets (B2)', () => {
    const bucket = (
      buyTx: number,
      sellTx = 0,
      swapTx = 0,
      buyUsers?: number,
      sellUsers?: number,
      swapUsers?: number,
    ) => ({
      date: new Date(TEST_BUCKET_DATE),
      volume: { buy: buyTx * 10, sell: sellTx * 10, swap: swapTx * 10 },
      transactions: { buy: buyTx, sell: sellTx, swap: swapTx },
      users: {
        buy: buyUsers ?? buyTx,
        sell: sellUsers ?? sellTx,
        swap: swapUsers ?? swapTx,
      },
      suppressed: false,
      partial: false,
    });

    it('nullifies a bucket with 4 transactions and keeps one with 5 (plus complementary)', () => {
      const { buckets, suppressedCount } = suppressTimelineBuckets([bucket(4), bucket(5), bucket(20)]);

      expect(buckets[0].suppressed).toBe(true);
      expect(buckets[0].volume).toBeNull();
      expect(buckets[0].transactions).toBeNull();
      expect(buckets[1].suppressed).toBe(true);
      expect(buckets[2].suppressed).toBe(false);
      expect(buckets[2].volume).toEqual({ buy: 200, sell: 0, swap: 0 });
      expect(suppressedCount).toBe(2);
    });

    it('suppresses mixed bucket when any single direction is under k (block rule)', () => {
      // buy=5 (ok), sell=1 (under) → whole bucket suppressed even though total=6 ≥ k
      const mixed = bucket(5, 1, 0);
      const large = bucket(20, 20, 20);
      const { buckets, suppressedCount } = suppressTimelineBuckets([mixed, large]);

      expect(buckets[0].suppressed).toBe(true);
      expect(buckets[0].volume).toBeNull();
      expect(buckets[0].transactions).toBeNull();
      // Exactly one under-k bucket → complementary also suppresses the only other filled bucket.
      // (The old `if (!buckets[1].suppressed)` body was dead: complementary always fires here.)
      expect(buckets[1].suppressed).toBe(true);
      expect(buckets[1].transactions).toBeNull();
      expect(suppressedCount).toBe(2);
      // total − visible must not recover sell=1: every filled bucket is withheld.
      const visibleSell = buckets.filter((b) => !b.suppressed).reduce((sum, b) => sum + (b.transactions?.sell ?? 0), 0);
      expect(visibleSell).toBe(0);
      expect(visibleSell).not.toBe(1);
    });

    it('keeps a bucket at exactly k when no complementary case applies', () => {
      const { buckets, suppressedCount } = suppressTimelineBuckets([bucket(4), bucket(3), bucket(5)]);

      expect(buckets[0].suppressed).toBe(true);
      expect(buckets[1].suppressed).toBe(true);
      expect(buckets[2].suppressed).toBe(false);
      expect(buckets[2].transactions).toEqual({ buy: 5, sell: 0, swap: 0 });
      expect(suppressedCount).toBe(2);
    });

    it('leaves empty (0-tx) buckets as visible zeros, not suppressed', () => {
      const empty = bucket(0);
      const filled = bucket(10);
      const { buckets, suppressedCount } = suppressTimelineBuckets([empty, filled]);

      expect(buckets[0].suppressed).toBe(false);
      expect(buckets[0].volume).toEqual({ buy: 0, sell: 0, swap: 0 });
      expect(buckets[0].transactions).toEqual({ buy: 0, sell: 0, swap: 0 });
      expect(buckets[1].suppressed).toBe(false);
      expect(suppressedCount).toBe(0);
    });

    it('still applies complementary when empty days would otherwise defeat it (B2 security)', () => {
      const empties = [bucket(0), bucket(0), bucket(0), bucket(0), bucket(0)];
      const under = bucket(3);
      const small = bucket(6);
      const large = bucket(50);
      const large2 = bucket(40);

      const { buckets, suppressedCount } = suppressTimelineBuckets([...empties, under, small, large, large2]);

      for (let i = 0; i < empties.length; i++) {
        expect(buckets[i].suppressed).toBe(false);
        expect(buckets[i].transactions).toEqual({ buy: 0, sell: 0, swap: 0 });
        expect(buckets[i].volume).toEqual({ buy: 0, sell: 0, swap: 0 });
      }

      expect(buckets[empties.length].suppressed).toBe(true);
      expect(buckets[empties.length].volume).toBeNull();
      expect(buckets[empties.length + 1].suppressed).toBe(true);
      expect(buckets[empties.length + 2].suppressed).toBe(false);
      expect(buckets[empties.length + 3].suppressed).toBe(false);
      expect(suppressedCount).toBe(2);
    });

    it('suppresses when person count is under k despite high transaction totals', () => {
      // Per-direction txs look fine on count alone (20 ≥ k), but only 3 persons → withheld.
      const fewPeople = {
        date: new Date(TEST_BUCKET_DATE),
        volume: { buy: 200, sell: 0, swap: 0 },
        transactions: { buy: 20, sell: 0, swap: 0 },
        users: { buy: 3, sell: 0, swap: 0 },
        suppressed: false,
        partial: false,
      };
      const large = bucket(50, 50, 50);
      const { buckets, suppressedCount } = suppressTimelineBuckets([fewPeople, large]);

      expect(buckets[0].suppressed).toBe(true);
      expect(buckets[0].volume).toBeNull();
      expect(buckets[0].transactions).toBeNull();
      expect(suppressedCount).toBeGreaterThanOrEqual(1);
    });

    it('uses Math.max (not min) of per-direction users as the bucket person-floor lower bound', () => {
      // buy/sell well above k; swap has 0 txs but a leftover users=1 that must not collapse the
      // person floor via Math.min — max(10,10,1)=10 keeps the bucket visible.
      const mixed = {
        date: new Date(TEST_BUCKET_DATE),
        volume: { buy: 100, sell: 100, swap: 0 },
        transactions: { buy: 10, sell: 10, swap: 0 },
        users: { buy: 10, sell: 10, swap: 1 },
        suppressed: false,
        partial: false,
      };
      const { buckets, suppressedCount } = suppressTimelineBuckets([mixed]);
      expect(buckets[0].suppressed).toBe(false);
      expect(buckets[0].transactions).toEqual({ buy: 10, sell: 10, swap: 0 });
      expect(suppressedCount).toBe(0);
    });

    it('uses total transaction count alone when no per-bucket users are provided', () => {
      const noUsers = {
        date: new Date(TEST_BUCKET_DATE),
        volume: { buy: 40, sell: 0, swap: 0 },
        transactions: { buy: 4, sell: 0, swap: 0 },
        suppressed: false,
        partial: false,
      };
      const large = {
        date: new Date(TEST_BUCKET_DATE),
        volume: { buy: 500, sell: 0, swap: 0 },
        transactions: { buy: 50, sell: 0, swap: 0 },
        suppressed: false,
        partial: false,
      };
      const { buckets } = suppressTimelineBuckets([noUsers, large]);
      expect(buckets[0].suppressed).toBe(true);
      expect(buckets[0].volume).toBeNull();
    });

    it('leaves a bucket with null transactions untouched (no suppression flag)', () => {
      const missing = {
        date: new Date(TEST_BUCKET_DATE),
        volume: null,
        transactions: null,
        suppressed: false,
        partial: false,
      };
      const large = bucket(50);
      const { buckets, suppressedCount } = suppressTimelineBuckets([missing, large]);
      expect(buckets[0].suppressed).toBe(false);
      expect(buckets[0].transactions).toBeNull();
      expect(suppressedCount).toBe(0);
    });
  });

  describe('suppressPeriodTotals (B3 / block rule)', () => {
    it('nulls all totals fields when overall transactions.total is in 1..k-1', () => {
      const { volume, transactions, averageTransactionVolume, suppressedCount } = suppressPeriodTotals(
        { buy: 100, sell: 0, swap: 0, total: 100 },
        { buy: 3, sell: 0, swap: 0, total: 3 },
        { buy: 3, sell: 0, swap: 0, total: 3 },
      );

      expect(volume).toEqual({ buy: null, sell: null, swap: null, total: null });
      expect(transactions).toEqual({ buy: null, sell: null, swap: null, total: null });
      expect(averageTransactionVolume).toBeNull();
      expect(suppressedCount).toBe(1);
    });

    it('block-suppresses the entire group when any direction is under k (no partial nulling)', () => {
      // Previously leaked: sell=null but total/buy/swap visible → sell = total − buy − swap.
      const mixed = suppressPeriodTotals(
        { buy: 1000, sell: 10, swap: 200, total: 1210 },
        { buy: 20, sell: 2, swap: 10, total: 32 },
        { buy: 10, sell: 2, swap: 8, total: 15 },
      );
      expect(mixed.volume).toEqual({ buy: null, sell: null, swap: null, total: null });
      expect(mixed.transactions).toEqual({ buy: null, sell: null, swap: null, total: null });
      expect(mixed.averageTransactionVolume).toBeNull();
      expect(mixed.suppressedCount).toBe(1);
      // Reconstruction must fail
      expect(mixed.volume.total).toBeNull();
    });

    it('keeps totals at exactly k for every direction and overall', () => {
      const atK = suppressPeriodTotals(
        { buy: 500, sell: 0, swap: 0, total: 500 },
        { buy: 5, sell: 0, swap: 0, total: 5 },
        { buy: 5, sell: 0, swap: 0, total: 5 },
      );
      expect(atK.volume.total).toBe(500);
      expect(atK.transactions.total).toBe(5);
      expect(atK.volume.buy).toBe(500);
      expect(atK.suppressedCount).toBe(0);
      expect(atK.averageTransactionVolume).toBe(100);
    });

    it('suppresses when transaction count is high but person count is under k', () => {
      const personGate = suppressPeriodTotals(
        { buy: 1000, sell: 0, swap: 0, total: 1000 },
        { buy: 20, sell: 0, swap: 0, total: 20 },
        { buy: 2, sell: 0, swap: 0, total: 2 },
      );
      expect(personGate.volume.total).toBeNull();
      expect(personGate.suppressedCount).toBe(1);
    });

    it('leaves all-zero totals as zeros, not null', () => {
      const { volume, transactions, averageTransactionVolume, suppressedCount } = suppressPeriodTotals(
        { buy: 0, sell: 0, swap: 0, total: 0 },
        { buy: 0, sell: 0, swap: 0, total: 0 },
        { buy: 0, sell: 0, swap: 0, total: 0 },
      );
      expect(volume.total).toBe(0);
      expect(transactions.total).toBe(0);
      expect(averageTransactionVolume).toBeNull();
      expect(suppressedCount).toBe(0);
    });
  });

  describe('suppressAllTimeVolume (B3)', () => {
    it('nulls all-time volume when tradingUsers is in 1..k-1 and keeps it at k', () => {
      const under = suppressAllTimeVolume({ buy: 100, sell: 50, total: 150 }, 3);
      expect(under.volume).toEqual({ buy: null, sell: null, total: null });
      expect(under.suppressedCount).toBe(1);

      const atK = suppressAllTimeVolume({ buy: 100, sell: 50, total: 150 }, 5);
      expect(atK.volume).toEqual({ buy: 100, sell: 50, total: 150 });
      expect(atK.suppressedCount).toBe(0);

      const zero = suppressAllTimeVolume({ buy: 0, sell: 0, total: 0 }, 0);
      expect(zero.volume).toEqual({ buy: 0, sell: 0, total: 0 });
      expect(zero.suppressedCount).toBe(0);
    });
  });
});
