import {
  PARTNER_STATISTIC_SUPPRESSION_THRESHOLD,
  PartnerStatisticDirection,
  PartnerStatisticDirectionField,
} from './partner-statistic.enum';

/**
 * k-anonymity helpers for partner statistics.
 *
 * A disclosure unit is withheld when its effective count is in 1..k-1.
 * The effective count is min(transactions, distinctUsers) when both are known;
 * otherwise the transaction count alone.
 *
 * Additive groups (period totals by direction, timeline bucket directions) use
 * block suppression: if any member is under the threshold, the entire group
 * (members + derived sums/rates) is suppressed. Partial nulling would let
 * totals − visible recover the hidden member exactly.
 *
 * Zero is never suppressed: 0 means “none”, null means “withheld”.
 */

export function effectiveCount(transactions: number, users?: number): number {
  if (users == null) return transactions;
  return Math.min(transactions, users);
}

export function isUnderThreshold(
  transactions: number,
  users?: number,
  threshold = PARTNER_STATISTIC_SUPPRESSION_THRESHOLD,
): boolean {
  const n = effectiveCount(transactions, users);
  return n > 0 && n < threshold;
}

export function suppressScalar(
  value: number,
  threshold = PARTNER_STATISTIC_SUPPRESSION_THRESHOLD,
  users?: number,
): number | null {
  if (value === 0) return 0;
  return isUnderThreshold(value, users, threshold) ? null : value;
}

export interface SuppressibleRow {
  transactions: number;
  /** Distinct users contributing to this row; when set, min(tx, users) is the gate. */
  users?: number;
}

/**
 * Removes rows with effective count in 1..k-1. If exactly one row is removed, also removes the
 * smallest remaining filled row so never fewer than two are suppressed when complementary applies.
 */
export function suppressBreakdownRows<T extends SuppressibleRow>(
  rows: T[],
  threshold = PARTNER_STATISTIC_SUPPRESSION_THRESHOLD,
): { rows: T[]; suppressedCount: number } {
  const visible = rows.filter((r) => !isUnderThreshold(r.transactions, r.users, threshold));
  let suppressedCount = rows.length - visible.length;

  if (suppressedCount === 1) {
    // Complementary: suppress the smallest remaining filled row. SQL GROUP BY never emits
    // 0-count groups, so a filled candidate exists whenever a non-empty visible set remains
    // after dropping a single under-k row of real traffic. Zero-only remainders (synthetic
    // fixtures) need no complementary partner — skip.
    let smallest: T | undefined;
    for (const r of visible) {
      if (effectiveCount(r.transactions, r.users) <= 0) continue;
      if (
        !smallest ||
        effectiveCount(r.transactions, r.users) <= effectiveCount(smallest.transactions, smallest.users)
      ) {
        smallest = r;
      }
    }
    if (smallest) {
      visible.splice(visible.indexOf(smallest), 1);
      suppressedCount += 1;
    }
  }

  return { rows: visible, suppressedCount };
}

export interface TimelineSuppressible {
  transactions: { buy: number; sell: number; swap: number } | null;
  volume: { buy: number; sell: number; swap: number } | null;
  /** Distinct users per direction (internal; not required on the public DTO). */
  users?: { buy: number; sell: number; swap: number } | null;
  suppressed: boolean;
}

const DIRECTIONS = [
  PartnerStatisticDirection.BUY,
  PartnerStatisticDirection.SELL,
  PartnerStatisticDirection.SWAP,
] as const;

/**
 * Nullifies volume/transactions when any direction is under the threshold (block rule),
 * or when the combined effective total is under k.
 * Empty (0-tx) buckets stay visible as zeros — they are not suppressed.
 * Complementary: if exactly one real suppression, also suppress the smallest filled visible bucket.
 */
export function suppressTimelineBuckets<T extends TimelineSuppressible>(
  buckets: T[],
  threshold = PARTNER_STATISTIC_SUPPRESSION_THRESHOLD,
): { buckets: T[]; suppressedCount: number } {
  const result = buckets.map((b) => {
    if (bucketNeedsSuppression(b, threshold)) {
      return { ...b, volume: null, transactions: null, users: null, suppressed: true } as T;
    }
    return { ...b, suppressed: false };
  });

  let suppressedCount = result.filter((b) => b.suppressed).length;

  if (suppressedCount === 1) {
    const visible = result
      .map((b, index) => ({ b, index, total: txTotal(b) }))
      .filter((x) => !x.b.suppressed && x.total > 0);

    if (visible.length > 0) {
      visible.sort((a, b) => a.total - b.total);
      const target = visible[0].index;
      result[target] = {
        ...result[target],
        volume: null,
        transactions: null,
        users: null,
        suppressed: true,
      } as T;
      suppressedCount += 1;
    }
  }

  return { buckets: result, suppressedCount };
}

function bucketNeedsSuppression(b: TimelineSuppressible, threshold: number): boolean {
  if (!b.transactions) return false;
  const txs = b.transactions;
  const users = b.users;

  // Per-direction gate (block rule for the bucket as an additive group).
  for (const dir of DIRECTIONS) {
    const field = PartnerStatisticDirectionField[dir];
    if (isUnderThreshold(txs[field], users?.[field], threshold)) return true;
  }

  // Overall bucket total: if the whole day is under k when summed, hide it too.
  const totalTx = txs.buy + txs.sell + txs.swap;
  if (totalTx === 0) return false;
  // Distinct users across directions can overlap; without a true UNION we use max of the
  // per-direction user counts as a lower bound on the person count whenever a users object
  // is present (callers always supply all three directions, including zeros).
  if (users) {
    const totalUsers = Math.max(users.buy, users.sell, users.swap);
    return isUnderThreshold(totalTx, totalUsers, threshold);
  }
  return isUnderThreshold(totalTx, undefined, threshold);
}

export interface DirectionTotals {
  buy: number;
  sell: number;
  swap: number;
  total: number;
}

export interface DirectionUsers {
  buy: number;
  sell: number;
  swap: number;
  /** Distinct users across all directions (UNION), used for the total gate. */
  total: number;
}

export interface SuppressedDirectionTotals {
  buy: number | null;
  sell: number | null;
  swap: number | null;
  total: number | null;
}

/**
 * Block-suppresses period totals: if any direction (or the overall total) is under k,
 * every field is null — including derived average. No partial nulling of single directions.
 */
export function suppressPeriodTotals(
  volume: DirectionTotals,
  transactions: DirectionTotals,
  users?: DirectionUsers,
  threshold = PARTNER_STATISTIC_SUPPRESSION_THRESHOLD,
): {
  volume: SuppressedDirectionTotals;
  transactions: SuppressedDirectionTotals;
  averageTransactionVolume: number | null;
  suppressedCount: number;
} {
  const under = (dir: keyof DirectionTotals): boolean => isUnderThreshold(transactions[dir], users?.[dir], threshold);

  if (under('total') || under('buy') || under('sell') || under('swap')) {
    return {
      volume: { buy: null, sell: null, swap: null, total: null },
      transactions: { buy: null, sell: null, swap: null, total: null },
      averageTransactionVolume: null,
      suppressedCount: 1,
    };
  }

  const averageTransactionVolume = transactions.total > 0 ? volume.total / transactions.total : null;

  return {
    volume: { ...volume },
    transactions: { ...transactions },
    averageTransactionVolume,
    suppressedCount: 0,
  };
}

export interface AllTimeVolume {
  buy: number;
  sell: number;
  total: number;
}

/**
 * When tradingUsers is in 1..k-1, all-time volumes are withheld. registeredUsers stays visible
 * (installation count, not a per-trade disclosure).
 */
export function suppressAllTimeVolume(
  volume: AllTimeVolume,
  tradingUsers: number,
  threshold = PARTNER_STATISTIC_SUPPRESSION_THRESHOLD,
): { volume: { buy: number | null; sell: number | null; total: number | null }; suppressedCount: number } {
  if (isUnderThreshold(tradingUsers, undefined, threshold)) {
    return {
      volume: { buy: null, sell: null, total: null },
      suppressedCount: 1,
    };
  }
  return { volume, suppressedCount: 0 };
}

function txTotal(b: TimelineSuppressible): number {
  if (b.suppressed || !b.transactions) return 0;
  return b.transactions.buy + b.transactions.sell + b.transactions.swap;
}
