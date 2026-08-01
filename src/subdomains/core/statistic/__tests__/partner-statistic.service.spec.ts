import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from 'src/config/config';
import { BuyCryptoRepository } from 'src/subdomains/core/buy-crypto/process/repositories/buy-crypto.repository';
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import { UserRepository } from 'src/subdomains/generic/user/models/user/user.repository';
import { WalletRepository } from 'src/subdomains/generic/user/models/wallet/wallet.repository';
import {
  PARTNER_STATISTIC_DEFAULT_PERIOD_DAYS,
  PARTNER_STATISTIC_MAX_PERIOD_DAYS,
  PARTNER_STATISTIC_QUERY_CONCURRENCY,
  PartnerStatisticDirection,
  PartnerStatisticGranularity,
} from '../partner-statistic.enum';
import { PartnerStatisticService } from '../partner-statistic.service';

// Timeline and period resolution are UTC-only (no process.TZ pin). Specs must stay green under
// arbitrary host timezones — see "timezone independence" below.

type Direction = PartnerStatisticDirection;

/**
 * Single calendar anchor for all period fixtures. Every from/to is derived from this
 * (or from `new Date()` via fake timers) so tests do not go stale as wall-clock years pass.
 */
const TEST_NOW = new Date('2024-06-15T12:00:00.000Z');
const PERIOD_FROM = new Date('2024-05-16T00:00:00.000Z');
const PERIOD_TO = TEST_NOW;
/**
 * resolvePeriod snaps `to` to exclusive next-day UTC midnight.
 * Bound :from/:to on getStatistics(…, PERIOD_FROM, PERIOD_TO) must equal these values.
 */
const RESOLVED_PERIOD_FROM = PERIOD_FROM;
const RESOLVED_PERIOD_TO = new Date('2024-06-16T00:00:00.000Z');
/** Wednesday UTC before TEST_NOW (Saturday) — mid-week so week-edge buckets are partial. */
const MID_WEEK_FROM = new Date('2024-06-12T00:00:00.000Z');
const MID_WEEK_TO = new Date('2024-06-19T00:00:00.000Z');

/**
 * getStatistics clause budgets captured by the unit-test harness.
 *
 * How the numbers arise from the production call graph (one getStatistics request):
 * - SCOPED_BUILDERS (20): 3 direction aggs + 3 active-user UNION legs + newUsers + allTime
 *   + referral + 3 asset + 2 fiat + 3 blockchain + 3 payment-method = 20 wallet-scoped WHEREs
 * - AML_FILTERS (17): baseTxQuery × (3 dir + 3 active + 3 asset + 2 fiat + 3 blockchain + 3 payment)
 * - PERIOD_FILTERS (18): those 17 baseTxQuery half-open bounds + countNewUsers (user.created)
 * - WHERE_CLAUSES (55): 17×(scope+period+aml) + newUsers(scope+period) + allTime(scope)
 *   + referral(scope)
 * - ACTIVE_USER_UNION_LEGS (3): buy / sell / swap getQuery legs in countActiveUsers
 *
 * Keep these in one place: a legitimate expansion must update the budget once, not three copies.
 */
export const GET_STATISTICS_CLAUSE_BUDGET = {
  SCOPED_BUILDERS: 20,
  AML_FILTERS: 17,
  PERIOD_FILTERS: 18,
  WHERE_CLAUSES: 55,
  ACTIVE_USER_UNION_LEGS: 3,
} as const;

/** Multiset equality: same elements with same multiplicity, order ignored. */
function expectMultisetEqual(actual: string[], expected: string[]): void {
  expect([...actual].sort()).toEqual([...expected].sort());
}

interface DirectionFixture {
  volume: number;
  transactions: number;
  users: number;
}

interface WalletFixture {
  buy: DirectionFixture;
  sell: DirectionFixture;
  swap: DirectionFixture;
  activeUserIds: number[];
  newUsers: number;
  allTime: { buy: number; sell: number; registeredUsers: number; tradingUsers: number };
  referral: { volume: number; partnerRefCredit: number; refCredit: number; paidRefCredit: number };
  /** When true, wallet getRawOne returns null (missing wallet row). */
  missingWallet?: boolean;
  /** Named breakdown rows returned by getRawMany for asset/fiat/blockchain/payment queries. */
  namedRows: { name: string; blockchain?: string; volume: number; transactions: number; users: number }[];
  timelineRows: { bucket: Date; volume: number; transactions: number; users: number }[];
}

function emptyFixture(overrides: Partial<WalletFixture> = {}): WalletFixture {
  return {
    buy: { volume: 0, transactions: 0, users: 0 },
    sell: { volume: 0, transactions: 0, users: 0 },
    swap: { volume: 0, transactions: 0, users: 0 },
    activeUserIds: [],
    newUsers: 0,
    allTime: { buy: 0, sell: 0, registeredUsers: 0, tradingUsers: 0 },
    referral: { volume: 0, partnerRefCredit: 0, refCredit: 0, paidRefCredit: 0 },
    namedRows: [],
    timelineRows: [],
    ...overrides,
  };
}

/** Recursively collect every own-property key name in a JSON-serializable value. */
function collectKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (value == null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
    return out;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out.add(k);
    collectKeys(v, out);
  }
  return out;
}

interface QbState {
  walletId?: number;
  direction?: Direction;
  selects: string[];
  selectAliases: string[];
  groupBys: string[];
  isTimeline: boolean;
  isAllTime: boolean;
  isReferral: boolean;
}

interface GroupByCapture {
  groupBys: string[];
  selectAliases: string[];
}

describe('PartnerStatisticService', () => {
  let service: PartnerStatisticService;
  let fixtures: Map<number, WalletFixture>;
  let lastWalletIds: number[];
  let whereClauses: string[];
  let amlFilterClauses: string[];
  /** Bound `{ from, to }` from every where/andWhere that supplies period params. */
  let periodBoundParams: { from: unknown; to: unknown }[];
  let groupByCapture: GroupByCapture;
  let managerCreateQueryBuilderCalls: number;
  let getQueryCalls: number;
  /** SQL passed to manager.createQueryBuilder().from(…) for the active-user UNION. */
  let activeUserUnionFromSql: string | undefined;
  let activeUserCountFromManager: number | undefined;
  let concurrentQueries: number;
  let maxConcurrentQueries: number;
  let queryDelayMs: number;
  let nonNumericVolume: string | number | null | undefined | false;

  /**
   * Records walletId from query params when present and returns it for fixture routing.
   * `params &&` already excludes null/undefined — no separate null check (CodeQL inconvertible types).
   */
  function trackWalletId(params?: unknown): number | undefined {
    if (params && typeof params === 'object' && 'walletId' in params) {
      const id = (params as { walletId: unknown }).walletId;
      if (typeof id === 'number') {
        lastWalletIds.push(id);
        return id;
      }
    }
    return undefined;
  }

  function fixtureFor(walletId?: number): WalletFixture {
    if (walletId == null) {
      // Unscoped fallback when a QB never captured :walletId (harness gap). Must still
      // carry boolean flags — dropping missingWallet made D6 return a synthetic row
      // (merged volumes, row present) instead of null, so getStatistics did not throw.
      const merged = emptyFixture();
      for (const f of fixtures.values()) {
        merged.buy.volume += f.buy.volume;
        merged.buy.transactions += f.buy.transactions;
        merged.buy.users += f.buy.users;
        merged.sell.volume += f.sell.volume;
        merged.sell.transactions += f.sell.transactions;
        merged.sell.users += f.sell.users;
        merged.swap.volume += f.swap.volume;
        merged.swap.transactions += f.swap.transactions;
        merged.swap.users += f.swap.users;
        merged.activeUserIds.push(...f.activeUserIds);
        merged.newUsers += f.newUsers;
        merged.allTime.buy += f.allTime.buy;
        merged.allTime.sell += f.allTime.sell;
        merged.allTime.registeredUsers += f.allTime.registeredUsers;
        merged.allTime.tradingUsers += f.allTime.tradingUsers;
        merged.referral.volume += f.referral.volume;
        merged.referral.partnerRefCredit += f.referral.partnerRefCredit;
        merged.referral.refCredit += f.referral.refCredit;
        merged.referral.paidRefCredit += f.referral.paidRefCredit;
        merged.namedRows.push(...f.namedRows);
        merged.timelineRows.push(...f.timelineRows);
        if (f.missingWallet) merged.missingWallet = true;
      }
      return merged;
    }
    return fixtures.get(walletId) ?? emptyFixture();
  }

  async function trackConcurrency<T>(work: () => Promise<T>): Promise<T> {
    concurrentQueries += 1;
    maxConcurrentQueries = Math.max(maxConcurrentQueries, concurrentQueries);
    try {
      if (queryDelayMs > 0) await new Promise((r) => setTimeout(r, queryDelayMs));
      return await work();
    } finally {
      concurrentQueries -= 1;
    }
  }

  function createQb(kind: 'buyCrypto' | 'buyFiat' | 'user' | 'wallet') {
    const state: QbState = {
      selects: [],
      selectAliases: [],
      groupBys: [],
      isTimeline: false,
      isAllTime: false,
      isReferral: false,
    };

    const qb: Record<string, jest.Mock | (() => unknown)> = {};
    const self = () => qb;

    const recordSelect = (clause: unknown, alias?: unknown) => {
      const expr = String(clause);
      const label = alias != null ? String(alias) : expr;
      state.selects.push(expr);
      if (alias != null) {
        state.selectAliases.push(String(alias));
        groupByCapture.selectAliases.push(String(alias));
      }
      if (expr.includes('DATE_TRUNC') || label === 'bucket') state.isTimeline = true;
      if (label === 'registeredUsers' || expr.includes('registeredUsers')) state.isAllTime = true;
      if (label === 'partnerRefCredit' || expr.includes('partnerRefCredit')) state.isReferral = true;
    };

    const recordGroupBy = (clause: unknown) => {
      const g = String(clause);
      state.groupBys.push(g);
      groupByCapture.groupBys.push(g);
    };

    qb.select = jest.fn((clause: unknown, alias?: unknown) => {
      recordSelect(clause, alias);
      return self();
    });
    qb.addSelect = jest.fn((clause: unknown, alias?: unknown) => {
      recordSelect(clause, alias);
      return self();
    });
    qb.innerJoin = jest.fn((path: string) => {
      if (path === 'tx.buy') state.direction = PartnerStatisticDirection.BUY;
      if (path === 'tx.cryptoRoute') state.direction = PartnerStatisticDirection.SWAP;
      if (path === 'tx.sell') state.direction = PartnerStatisticDirection.SELL;
      return self();
    });
    qb.leftJoin = jest.fn(() => self());
    qb.groupBy = jest.fn((clause: unknown) => {
      recordGroupBy(clause);
      return self();
    });
    qb.addGroupBy = jest.fn((clause: unknown) => {
      recordGroupBy(clause);
      return self();
    });
    qb.orderBy = jest.fn(() => self());
    qb.setParameter = jest.fn(() => self());
    const capturePeriodParams = (params?: unknown) => {
      if (params && typeof params === 'object' && 'from' in params) {
        const p = params as { from: unknown; to?: unknown };
        periodBoundParams.push({ from: p.from, to: p.to });
      }
    };
    qb.where = jest.fn((clause: unknown, params?: unknown) => {
      whereClauses.push(String(clause));
      const walletId = trackWalletId(params);
      if (walletId !== undefined) state.walletId = walletId;
      capturePeriodParams(params);
      return self();
    });
    qb.andWhere = jest.fn((clause: unknown, params?: unknown) => {
      const clauseStr = String(clause);
      whereClauses.push(clauseStr);
      const walletId = trackWalletId(params);
      if (walletId !== undefined) state.walletId = walletId;
      capturePeriodParams(params);
      if (clauseStr.includes('amlCheck')) {
        amlFilterClauses.push(clauseStr);
      }
      return self();
    });
    qb.getQuery = jest.fn(() => {
      // countActiveUsers is the only production caller of getQuery (UNION legs).
      getQueryCalls += 1;
      return `SELECT user.id AS id FROM mock_${kind}_${state.direction ?? 'x'}`;
    });
    qb.getParameters = jest.fn(() => ({
      walletId: state.walletId,
      check: 'Pass',
      from: new Date(TEST_NOW),
      to: new Date(TEST_NOW),
    }));

    qb.getRawOne = jest.fn(async () =>
      trackConcurrency(async () => {
        // Wallet-row presence must not depend on whether :walletId was captured into
        // this QB's local state. Prefer the scoped fixture; if the id is missing, the
        // unscoped merge still carries missingWallet (see fixtureFor). Using a bare
        // emptyFixture() here would invent a row and silence D6.
        const f =
          kind === 'wallet' || state.isReferral
            ? state.walletId != null
              ? (fixtures.get(state.walletId) ?? emptyFixture())
              : fixtureFor(undefined)
            : fixtureFor(state.walletId);

        if (kind === 'wallet' || state.isReferral) {
          if (f.missingWallet) return null;
          return {
            volume: f.referral.volume,
            partnerRefCredit: f.referral.partnerRefCredit,
            refCredit: f.referral.refCredit,
            paidRefCredit: f.referral.paidRefCredit,
          };
        }

        if (kind === 'user' || state.isAllTime) {
          return {
            buy: f.allTime.buy,
            sell: f.allTime.sell,
            registeredUsers: f.allTime.registeredUsers,
            tradingUsers: f.allTime.tradingUsers,
          };
        }

        if (state.isTimeline) return null;

        const dir =
          state.direction ?? (kind === 'buyFiat' ? PartnerStatisticDirection.SELL : PartnerStatisticDirection.BUY);
        const agg =
          f[dir === PartnerStatisticDirection.BUY ? 'buy' : dir === PartnerStatisticDirection.SELL ? 'sell' : 'swap'];
        const volume = nonNumericVolume !== false ? nonNumericVolume : agg.volume;
        return { volume, transactions: agg.transactions, users: agg.users };
      }),
    );

    qb.getRawMany = jest.fn(async () =>
      trackConcurrency(async () => {
        if (state.isTimeline) {
          const f = fixtureFor(state.walletId);
          return f.timelineRows.map((r) => ({
            bucket: r.bucket,
            volume: r.volume,
            transactions: r.transactions,
            users: r.users,
          }));
        }
        // Breakdown path — exercise mergeNamedRows
        const f = fixtureFor(state.walletId);
        return f.namedRows.map((r) => ({
          name: r.name,
          blockchain: r.blockchain ?? null,
          volume: r.volume,
          transactions: r.transactions,
          users: r.users,
        }));
      }),
    );

    qb.getCount = jest.fn(async () => trackConcurrency(async () => fixtureFor(state.walletId).newUsers));

    return qb;
  }

  function createManagerQb() {
    const state: { walletId?: number } = {};
    const qb: Record<string, jest.Mock> = {};
    const self = () => qb;

    qb.select = jest.fn(() => self());
    qb.from = jest.fn((table: unknown) => {
      // countActiveUsers: .from(`(${unionSql})`, 'active_users') — capture the subquery so a
      // hand-written 4th UNION leg (or UNION ALL) is visible even when getQueryCalls stays 3.
      if (typeof table === 'string') activeUserUnionFromSql = table;
      return self();
    });
    qb.setParameters = jest.fn((params: Record<string, unknown>) => {
      const walletId = trackWalletId(params);
      if (walletId !== undefined) state.walletId = walletId;
      return self();
    });
    qb.getRawOne = jest.fn(async () =>
      trackConcurrency(async () => {
        managerCreateQueryBuilderCalls += 1;
        const f = fixtureFor(state.walletId);
        const count = activeUserCountFromManager ?? f.activeUserIds.length;
        return { count };
      }),
    );

    return qb;
  }

  /**
   * Pins the active-user UNION shape: exactly three set-legs joined by UNION (not UNION ALL),
   * and no extra hand-written SELECT leg that would skip getQueryCalls.
   */
  function expectActiveUserUnionShape(): void {
    expect(getQueryCalls).toBe(GET_STATISTICS_CLAUSE_BUDGET.ACTIVE_USER_UNION_LEGS);
    expect(activeUserUnionFromSql).toBeDefined();
    const sql = activeUserUnionFromSql as string;
    expect(sql).not.toMatch(/UNION\s+ALL/i);
    // Outer wrapper is `(${unionSql})`; count bare UNION separators between legs.
    const unionSeparators = (sql.match(/\bUNION\b/gi) ?? []).length;
    expect(unionSeparators).toBe(GET_STATISTICS_CLAUSE_BUDGET.ACTIVE_USER_UNION_LEGS - 1);
  }

  /** Pins half-open period clause text *and* the bound :from/:to values. */
  function expectPeriodBoundsMatchResolved(): void {
    const PERIOD_EXACT_RE = /^(?:tx|user)\.created\s*>=\s*:from\s+AND\s+(?:tx|user)\.created\s*<\s*:to$/;
    const halfOpen = whereClauses.filter((c) => PERIOD_EXACT_RE.test(c));
    expect(halfOpen).toHaveLength(GET_STATISTICS_CLAUSE_BUDGET.PERIOD_FILTERS);
    // Every period-bearing andWhere must bind the resolved window — clause-only pins miss
    // `from: new Date(0)` (or a dropped `to`) while the SQL text stays identical.
    expect(periodBoundParams).toHaveLength(GET_STATISTICS_CLAUSE_BUDGET.PERIOD_FILTERS);
    for (const p of periodBoundParams) {
      expect(p.from).toEqual(RESOLVED_PERIOD_FROM);
      expect(p.to).toEqual(RESOLVED_PERIOD_TO);
      expect(p.from).not.toEqual(new Date(0));
    }
  }

  beforeEach(async () => {
    lastWalletIds = [];
    whereClauses = [];
    amlFilterClauses = [];
    periodBoundParams = [];
    fixtures = new Map();
    groupByCapture = { groupBys: [], selectAliases: [] };
    managerCreateQueryBuilderCalls = 0;
    getQueryCalls = 0;
    activeUserUnionFromSql = undefined;
    activeUserCountFromManager = undefined;
    concurrentQueries = 0;
    maxConcurrentQueries = 0;
    queryDelayMs = 0;
    nonNumericVolume = false;
    new ConfigService();

    const buyCryptoRepo = {
      createQueryBuilder: jest.fn(() => createQb('buyCrypto')),
      manager: {
        createQueryBuilder: jest.fn(() => createManagerQb()),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PartnerStatisticService,
        { provide: BuyCryptoRepository, useValue: buyCryptoRepo },
        { provide: BuyFiatRepository, useValue: { createQueryBuilder: jest.fn(() => createQb('buyFiat')) } },
        { provide: UserRepository, useValue: { createQueryBuilder: jest.fn(() => createQb('user')) } },
        { provide: WalletRepository, useValue: { createQueryBuilder: jest.fn(() => createQb('wallet')) } },
      ],
    }).compile();

    service = module.get(PartnerStatisticService);
  });

  // Fake timers must not leak into later tests (e.g. the concurrency cap that uses real setTimeout).
  // useRealTimers only on the success path left a broken assertion with fake time still on —
  // the next async test then hung until Jest's 5s timeout.
  afterEach(() => {
    jest.useRealTimers();
  });

  // --- PERIOD VALIDATION --- //

  describe('resolvePeriod', () => {
    it('defaults to the last 30 inclusive UTC calendar days when from/to are omitted', () => {
      jest.useFakeTimers().setSystemTime(TEST_NOW);

      const period = service.resolvePeriod();
      // to = start of day after TEST_NOW's UTC day
      expect(period.to.toISOString()).toBe('2024-06-16T00:00:00.000Z');
      // Inclusive N=30 → from = toDay − 29 = 2024-05-17
      expect(period.from.toISOString()).toBe(
        new Date(Date.UTC(2024, 5, 15 - (PARTNER_STATISTIC_DEFAULT_PERIOD_DAYS - 1))).toISOString(),
      );
      const spanDays = (period.to.getTime() - period.from.getTime()) / (24 * 3600 * 1000);
      expect(spanDays).toBe(PARTNER_STATISTIC_DEFAULT_PERIOD_DAYS);
    });

    it('snaps from to UTC day start and to to exclusive end of day', () => {
      const period = service.resolvePeriod('2024-06-01T15:30:00.000Z', '2024-06-03T08:00:00.000Z');
      expect(period.from.toISOString()).toBe('2024-06-01T00:00:00.000Z');
      expect(period.to.toISOString()).toBe('2024-06-04T00:00:00.000Z');
    });

    it('rejects from ≥ to after snap', () => {
      expect(() => service.resolvePeriod('2024-06-05', '2024-06-04')).toThrow(BadRequestException);
      expect(() => service.resolvePeriod('2024-06-05', '2024-06-04')).toThrow(/From must be before to/);
    });

    it('rejects periods longer than the max span', () => {
      const from = new Date(TEST_NOW.getTime() - (PARTNER_STATISTIC_MAX_PERIOD_DAYS + 50) * 24 * 3600 * 1000);
      const to = TEST_NOW;
      expect(() => service.resolvePeriod(from, to)).toThrow(BadRequestException);
      expect(() => service.resolvePeriod(from, to)).toThrow(String(PARTNER_STATISTIC_MAX_PERIOD_DAYS));
    });

    it('accepts a period of exactly the max span', () => {
      const from = new Date(TEST_NOW.getTime() - (PARTNER_STATISTIC_MAX_PERIOD_DAYS - 1) * 24 * 3600 * 1000);
      const to = TEST_NOW;
      expect(() => service.resolvePeriod(from, to)).not.toThrow();
    });

    it('accepts a single full day', () => {
      const period = service.resolvePeriod('2024-06-01T00:00:00.000Z', '2024-06-01T23:59:59.000Z');
      expect(period.from.toISOString()).toBe('2024-06-01T00:00:00.000Z');
      expect(period.to.toISOString()).toBe('2024-06-02T00:00:00.000Z');
    });

    it('default from is UTC-stable across process timezones and DST edges (D2)', () => {
      // Instant that lands on different local calendar dates in Berlin vs New York.
      const to = new Date('2024-11-02T00:30:00.000Z');
      const period = service.resolvePeriod(undefined, to);
      // 30 inclusive UTC days ending 2024-11-02 → from 2024-10-04
      expect(period.from.toISOString()).toBe('2024-10-04T00:00:00.000Z');
      expect(period.to.toISOString()).toBe('2024-11-03T00:00:00.000Z');

      // Near EU spring-forward (2024-03-31); local daysBefore would shift under Berlin.
      const toSpring = new Date('2024-04-05T23:30:00.000Z');
      const p2 = service.resolvePeriod(undefined, toSpring);
      expect(p2.from.toISOString()).toBe('2024-03-07T00:00:00.000Z');
      expect(p2.to.toISOString()).toBe('2024-04-06T00:00:00.000Z');

      // Same results under two process TZ values (UTC arithmetic must not consult local setDate).
      const prev = process.env.TZ;
      try {
        for (const tz of ['Europe/Berlin', 'America/New_York']) {
          process.env.TZ = tz;
          expect(service.resolvePeriod(undefined, to).from.toISOString()).toBe('2024-10-04T00:00:00.000Z');
          expect(service.resolvePeriod(undefined, toSpring).from.toISOString()).toBe('2024-03-07T00:00:00.000Z');
        }
      } finally {
        if (prev === undefined) delete process.env.TZ;
        else process.env.TZ = prev;
      }

      // Contrast: Util.daysBefore uses local setDate — under non-UTC hosts it can disagree.
      // We only assert our path is the UTC one above; we do not call Util.daysBefore here.
    });
  });

  describe('parseGranularity', () => {
    it('rejects invalid granularity with a clear message', () => {
      expect(() => service.parseGranularity('year')).toThrow(BadRequestException);
      expect(() => service.parseGranularity('year')).toThrow(/Day, Week, Month/);
    });

    it('accepts Day|Week|Month', () => {
      expect(service.parseGranularity('Day')).toBe(PartnerStatisticGranularity.DAY);
      expect(service.parseGranularity('Week')).toBe(PartnerStatisticGranularity.WEEK);
      expect(service.parseGranularity('Month')).toBe(PartnerStatisticGranularity.MONTH);
    });
  });

  describe('parseDate', () => {
    it('accepts YYYY-MM-DD as UTC midnight', () => {
      const d = service.parseDate('2026-01-15');
      expect(d?.toISOString()).toBe('2026-01-15T00:00:00.000Z');
    });

    it('accepts ISO-8601 with Z', () => {
      const d = service.parseDate('2026-01-15T12:30:00.000Z');
      expect(d?.toISOString()).toBe('2026-01-15T12:30:00.000Z');
    });

    it('accepts ISO-8601 with numeric offset', () => {
      const d = service.parseDate('2026-01-15T00:00:00+01:00');
      expect(d?.toISOString()).toBe('2026-01-14T23:00:00.000Z');
    });

    it('passes through a valid Date instance', () => {
      const input = new Date('2026-01-15T00:00:00.000Z');
      expect(service.parseDate(input)).toBe(input);
    });

    it('returns undefined for null/empty', () => {
      expect(service.parseDate(undefined)).toBeUndefined();
      expect(service.parseDate('')).toBeUndefined();
    });

    it('rejects timestamp without Z/offset (would be process-local under new Date)', () => {
      expect(() => service.parseDate('2026-01-15T00:00:00')).toThrow(BadRequestException);
      expect(() => service.parseDate('2026-01-15T00:00:00')).toThrow(/YYYY-MM-DD|ISO-8601|Z or offset/);
    });

    it('rejects free-text dates', () => {
      expect(() => service.parseDate('Jan 15 2026')).toThrow(BadRequestException);
      expect(() => service.parseDate('Jan 15 2026')).toThrow(/YYYY-MM-DD|ISO-8601|Z or offset/);
    });

    it("rejects numeric string '0' (new Date('0') is a real instant)", () => {
      expect(() => service.parseDate('0')).toThrow(BadRequestException);
      expect(() => service.parseDate('0')).toThrow(/YYYY-MM-DD|ISO-8601|Z or offset/);
    });

    it('rejects non-existent calendar days that Date would silently roll over', () => {
      // June has 30 days; Date('2024-06-31') becomes 2024-07-01 without this guard.
      expect(() => service.parseDate('2024-06-31')).toThrow(BadRequestException);
      expect(() => service.parseDate('2024-06-31')).toThrow(/YYYY-MM-DD|ISO-8601|Z or offset/);
      // 2023 is not a leap year.
      expect(() => service.parseDate('2023-02-29')).toThrow(BadRequestException);
      expect(() => service.parseDate('2024-02-30')).toThrow(BadRequestException);
    });

    it('rejects non-existent calendar days in ISO-with-Z form too', () => {
      expect(() => service.parseDate('2024-06-31T00:00:00.000Z')).toThrow(BadRequestException);
      expect(() => service.parseDate('2023-02-29T12:00:00+01:00')).toThrow(BadRequestException);
    });

    it('accepts a real leap-day (2024-02-29)', () => {
      const d = service.parseDate('2024-02-29');
      expect(d?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
      expect(service.parseDate('2024-02-29T00:00:00.000Z')?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
    });

    it('rejects out-of-range time components that pass the regex but yield Invalid Date', () => {
      // Calendar day is fine; hour 25 is not — this is the remaining isNaN guard path.
      expect(() => service.parseDate('2024-06-15T25:00:00.000Z')).toThrow(BadRequestException);
      expect(() => service.parseDate('2024-06-15T25:00:00.000Z')).toThrow(/YYYY-MM-DD|ISO-8601|Z or offset/);
    });
  });

  // --- B1: GROUP BY must not use SELECT aliases --- //

  describe('groupBy uses qualified columns, never SELECT aliases (B1)', () => {
    it('records only qualified columns or DATE_TRUNC expressions for every groupBy across all breakdowns', async () => {
      fixtures.set(
        1,
        emptyFixture({
          buy: { volume: 1000, transactions: 20, users: 10 },
          sell: { volume: 200, transactions: 10, users: 8 },
          swap: { volume: 50, transactions: 10, users: 6 },
          allTime: { buy: 5000, sell: 1000, registeredUsers: 100, tradingUsers: 40 },
          newUsers: 8,
          activeUserIds: [1, 2, 3, 4, 5, 6],
        }),
      );

      await service.getStatistics(1, PERIOD_FROM, PERIOD_TO);
      await service.getTimeline(1, PERIOD_FROM, new Date('2024-05-30T00:00:00.000Z'), PartnerStatisticGranularity.DAY);

      // Multiset (order-independent): runAll registration order is not a product contract.
      // toEqual on the full list went red on a pure reordering of aggregateBlockchains /
      // aggregatePaymentMethods in the getStatistics runAll list — 17-element diff, no
      // behaviour change. arrayContaining / length>0 still miss dropped or extra columns.
      const EXPECTED_GROUP_BYS = [
        // aggregateAssets: BUY, SELL, SWAP
        'outputAsset.name',
        'outputAsset.blockchain',
        'tx.inputAsset',
        'inputAsset.blockchain',
        'outputAsset.name',
        'outputAsset.blockchain',
        // aggregateFiatCurrencies: BUY input, SELL fiat
        'tx.inputAsset',
        'fiat.name',
        // aggregateBlockchains: BUY, SWAP, SELL
        'outputAsset.blockchain',
        'outputAsset.blockchain',
        'inputAsset.blockchain',
        // aggregatePaymentMethods: BUY, SELL, SWAP
        'transaction.sourceType',
        'transaction.sourceType',
        'transaction.sourceType',
        // timelineByDirection: BUY, SELL, SWAP
        "DATE_TRUNC('day', tx.created) AT TIME ZONE 'UTC'",
        "DATE_TRUNC('day', tx.created) AT TIME ZONE 'UTC'",
        "DATE_TRUNC('day', tx.created) AT TIME ZONE 'UTC'",
      ];
      expectMultisetEqual(groupByCapture.groupBys, EXPECTED_GROUP_BYS);

      const aliases = new Set(groupByCapture.selectAliases);
      for (const g of groupByCapture.groupBys) {
        const isQualified = g.includes('.');
        const isDateTrunc = g.startsWith('DATE_TRUNC(');
        expect(isQualified || isDateTrunc).toBe(true);
        expect(aliases.has(g)).toBe(false);
      }
    });
  });

  // --- SCOPE ISOLATION --- //

  describe('wallet scope isolation', () => {
    beforeEach(() => {
      fixtures.set(
        1,
        emptyFixture({
          buy: { volume: 1000, transactions: 10, users: 8 },
          sell: { volume: 200, transactions: 5, users: 5 },
          swap: { volume: 50, transactions: 5, users: 5 },
          allTime: { buy: 5000, sell: 1000, registeredUsers: 100, tradingUsers: 40 },
          referral: { volume: 50, partnerRefCredit: 10, refCredit: 0, paidRefCredit: 4 },
          newUsers: 8,
          activeUserIds: [11, 12, 13, 14, 15, 16],
        }),
      );
      fixtures.set(
        2,
        emptyFixture({
          buy: { volume: 99999, transactions: 999, users: 100 },
          sell: { volume: 88888, transactions: 888, users: 90 },
          swap: { volume: 77777, transactions: 777, users: 80 },
          allTime: { buy: 77777, sell: 66666, registeredUsers: 9999, tradingUsers: 8888 },
          referral: { volume: 12345, partnerRefCredit: 999, refCredit: 0, paidRefCredit: 111 },
          newUsers: 500,
          activeUserIds: [21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
        }),
      );
    });

    it('returns only wallet A aggregates and scopes SQL to user.walletId on every user-related query', async () => {
      const result = await service.getStatistics(1, PERIOD_FROM, PERIOD_TO);

      // Exact full-clause form (not substring): removing, rewriting, or OR-extending a scope
      // drops the count — unanchored filter+every is vacuum-true on survivors and on
      // `user.walletId = :walletId OR 1 = 1`. Budgets: GET_STATISTICS_CLAUSE_BUDGET.
      const SCOPE_EXACT_RE = /^(?:user\.walletId|wallet\.id)\s*=\s*:walletId$/;
      const scopeClauses = whereClauses.filter((c) => SCOPE_EXACT_RE.test(c));
      expect(scopeClauses).toHaveLength(GET_STATISTICS_CLAUSE_BUDGET.SCOPED_BUILDERS);
      expect(lastWalletIds.length).toBeGreaterThanOrEqual(GET_STATISTICS_CLAUSE_BUDGET.SCOPED_BUILDERS);
      expect(lastWalletIds.every((id) => id === 1)).toBe(true);
      expect(whereClauses.every((c) => !/user\.id\s*=\s*:walletId/.test(c))).toBe(true);

      // Pin count + exact clause so omitting SELL/SWAP (or OR-extending the check) fails;
      // length>0 + unanchored every was vacuum-true when only BUY kept the filter.
      const AML_EXACT_RE = /^tx\.amlCheck\s*=\s*:check$/;
      expect(amlFilterClauses).toHaveLength(GET_STATISTICS_CLAUSE_BUDGET.AML_FILTERS);
      expect(amlFilterClauses.every((c) => AML_EXACT_RE.test(c))).toBe(true);

      // Filtered pins (20/17/18) miss an extra unscoped WHERE that matches none of the three
      // exact regexes. Total pin + UNION shape (getQuery + from SQL) close that gap.
      expect(whereClauses).toHaveLength(GET_STATISTICS_CLAUSE_BUDGET.WHERE_CLAUSES);
      expectActiveUserUnionShape();
      expectPeriodBoundsMatchResolved();

      expect(result.totals.volume.buy).toBe(1000);
      expect(result.totals.volume.sell).toBe(200);
      expect(result.totals.volume.swap).toBe(50);
      expect(result.allTime.registeredUsers).toBe(100);
      expect(result.referral.volume).toBe(50);
      expect(result.referral.creditEarned).toBe(10);
      expect(result.totals.newUsers).toBe(8);

      expect(result.totals.volume.buy).not.toBe(99999);
      expect(result.allTime.registeredUsers).not.toBe(9999);
      expect(result.referral.volume).not.toBe(12345);
      expect(result.totals.newUsers).not.toBe(500);
    });

    it('returns only wallet B aggregates when called with wallet B (not wallet A)', async () => {
      // beforeEach already clears lastWalletIds / whereClauses / getQueryCalls / periodBoundParams
      // / activeUserUnionFromSql — no manual partial reset (that left getQueryCalls asymmetric).
      const result = await service.getStatistics(2, PERIOD_FROM, PERIOD_TO);

      const SCOPE_EXACT_RE = /^(?:user\.walletId|wallet\.id)\s*=\s*:walletId$/;
      const scopeClauses = whereClauses.filter((c) => SCOPE_EXACT_RE.test(c));
      expect(scopeClauses).toHaveLength(GET_STATISTICS_CLAUSE_BUDGET.SCOPED_BUILDERS);
      expect(whereClauses).toHaveLength(GET_STATISTICS_CLAUSE_BUDGET.WHERE_CLAUSES);
      expectActiveUserUnionShape();
      expectPeriodBoundsMatchResolved();
      expect(lastWalletIds.length).toBeGreaterThanOrEqual(GET_STATISTICS_CLAUSE_BUDGET.SCOPED_BUILDERS);
      expect(lastWalletIds.every((id) => id === 2)).toBe(true);

      expect(result.totals.volume.buy).toBe(99999);
      expect(result.totals.volume.buy).not.toBe(1000);
    });
  });

  // --- B3: totals / allTime suppression via service --- //

  describe('totals and allTime suppression (B3)', () => {
    it('nulls totals when overall transaction count is below k (boundary at k)', async () => {
      fixtures.set(
        1,
        emptyFixture({
          buy: { volume: 99, transactions: 4, users: 4 },
          allTime: { buy: 99, sell: 0, registeredUsers: 10, tradingUsers: 4 },
          newUsers: 0,
          activeUserIds: [1, 2, 3, 4],
        }),
      );

      const under = await service.getStatistics(1, PERIOD_FROM, PERIOD_TO);
      expect(under.totals.volume.total).toBeNull();
      expect(under.totals.volume.buy).toBeNull();
      expect(under.totals.transactions.total).toBeNull();
      expect(under.totals.averageTransactionVolume).toBeNull();
      expect(under.allTime.volume.total).toBeNull();
      expect(under.allTime.volume.buy).toBeNull();
      expect(under.allTime.registeredUsers).toBe(10);
      expect(under.allTime.tradingUsers).toBeNull();
      expect(under.referral.volume).toBeNull();
      expect(under.meta.suppressedCount).toBeGreaterThanOrEqual(2);

      fixtures.set(
        1,
        emptyFixture({
          buy: { volume: 100, transactions: 5, users: 5 },
          allTime: { buy: 100, sell: 0, registeredUsers: 10, tradingUsers: 5 },
          newUsers: 0,
          activeUserIds: [1, 2, 3, 4, 5],
        }),
      );

      const atK = await service.getStatistics(1, PERIOD_FROM, PERIOD_TO);
      expect(atK.totals.volume.total).toBe(100);
      expect(atK.totals.transactions.total).toBe(5);
      expect(atK.allTime.volume.total).toBe(100);
      expect(atK.allTime.tradingUsers).toBe(5);
    });

    it('nulls totals when person count is under k even with high transaction counts', async () => {
      fixtures.set(
        1,
        emptyFixture({
          buy: { volume: 1000, transactions: 20, users: 2 },
          allTime: { buy: 1000, sell: 0, registeredUsers: 10, tradingUsers: 5 },
          newUsers: 0,
          activeUserIds: [1, 2],
        }),
      );
      activeUserCountFromManager = 2;

      const result = await service.getStatistics(1, PERIOD_FROM, PERIOD_TO);
      expect(result.totals.volume.total).toBeNull();
      expect(result.totals.activeUsers).toBeNull();
    });

    it('sums buy+sell+swap into totals.volume.total (not a multiple of one direction)', async () => {
      fixtures.set(
        1,
        emptyFixture({
          buy: { volume: 100, transactions: 10, users: 8 },
          sell: { volume: 40, transactions: 10, users: 8 },
          swap: { volume: 25, transactions: 10, users: 8 },
          allTime: { buy: 100, sell: 40, registeredUsers: 20, tradingUsers: 15 },
          activeUserIds: [1, 2, 3, 4, 5, 6, 7, 8],
          newUsers: 0,
        }),
      );
      activeUserCountFromManager = 10;

      const result = await service.getStatistics(1, PERIOD_FROM, PERIOD_TO);
      expect(result.totals.volume.total).toBe(165);
      expect(result.totals.volume.total).not.toBe(100 + 40 + 2 * 25);
      expect(result.totals.transactions.total).toBe(30);
    });
  });

  // --- M2: active users via manager UNION count --- //

  describe('countActiveUsers uses DB COUNT over UNION (M2)', () => {
    it('returns the manager COUNT (not per-direction buy users) and uses the manager path', async () => {
      fixtures.set(
        1,
        emptyFixture({
          buy: { volume: 1000, transactions: 20, users: 10 },
          allTime: { buy: 1000, sell: 0, registeredUsers: 50, tradingUsers: 20 },
          activeUserIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
          newUsers: 0,
        }),
      );
      activeUserCountFromManager = 7;

      const result = await service.getStatistics(1, PERIOD_FROM, PERIOD_TO);

      expect(managerCreateQueryBuilderCalls).toBeGreaterThanOrEqual(1);
      // activeUsers comes from the UNION COUNT (7), not buyAgg.users (10)
      expect(result.totals.activeUsers).toBe(7);
      expect(result.totals.activeUsers).not.toBe(10);
    });

    it('gates period totals on the UNION active-user count, not buyAgg.users alone', async () => {
      // Each direction looks fine (≥ k users), but the true UNION is 3 → totals block-suppressed.
      // Mutation rawUsers.total = buyAgg.users would keep totals visible (buy users = 10).
      fixtures.set(
        1,
        emptyFixture({
          buy: { volume: 1000, transactions: 20, users: 10 },
          sell: { volume: 500, transactions: 15, users: 10 },
          swap: { volume: 200, transactions: 10, users: 10 },
          allTime: { buy: 1000, sell: 500, registeredUsers: 50, tradingUsers: 20 },
          activeUserIds: [1, 2, 3],
          newUsers: 0,
        }),
      );
      activeUserCountFromManager = 3;

      const result = await service.getStatistics(1, PERIOD_FROM, PERIOD_TO);
      expect(result.totals.volume.total).toBeNull();
      expect(result.totals.transactions.total).toBeNull();
      expect(result.totals.activeUsers).toBeNull();
    });
  });

  // --- CURRENCY / REFERRAL --- //

  describe('currency separation and referral creditOpen', () => {
    it('keeps referral in EUR and computes creditOpen as ref + partner − paid', async () => {
      fixtures.set(
        1,
        emptyFixture({
          buy: { volume: 100, transactions: 10, users: 5 },
          // partner earned 12.25, personal ref 5, paid 2.25 → open = 15
          referral: { volume: 42.5, partnerRefCredit: 12.25, refCredit: 5, paidRefCredit: 2.25 },
          allTime: { buy: 100, sell: 0, registeredUsers: 10, tradingUsers: 5 },
          newUsers: 5,
          activeUserIds: [1, 2, 3, 4, 5],
        }),
      );

      const result = await service.getStatistics(1, PERIOD_FROM, PERIOD_TO);

      expect(result.currency).toBe('CHF');
      expect(result.referral.currency).toBe('EUR');
      expect(result.referral.volume).toBe(42.5);
      expect(result.referral.creditEarned).toBe(12.25);
      expect(result.referral.creditPaid).toBe(2.25);
      expect(result.referral.creditOpen).toBe(15);
      // Old formula partner − paid would yield 10 — must not regress
      expect(result.referral.creditOpen).not.toBe(10);
      expect(result.totals.volume.buy).toBe(100);
    });

    it('throws when the wallet row is missing (D6 — not silent zero referral)', async () => {
      fixtures.set(
        1,
        emptyFixture({
          buy: { volume: 100, transactions: 10, users: 5 },
          allTime: { buy: 100, sell: 0, registeredUsers: 10, tradingUsers: 5 },
          activeUserIds: [1, 2, 3, 4, 5],
          missingWallet: true,
        }),
      );

      await expect(service.getStatistics(1, PERIOD_FROM, PERIOD_TO)).rejects.toThrow(/wallet 1 not found/);
    });

    it('D6 harness: missingWallet survives unscoped fixture merge (walletId not captured)', async () => {
      // Reproduces the flake: when state.walletId is unset, getRawOne used to call
      // fixtureFor(undefined), which summed volumes but dropped missingWallet — so the
      // wallet query invented a row and getStatistics returned instead of throwing.
      fixtures.set(
        1,
        emptyFixture({
          buy: { volume: 100, transactions: 10, users: 5 },
          allTime: { buy: 100, sell: 0, registeredUsers: 10, tradingUsers: 5 },
          activeUserIds: [1, 2, 3, 4, 5],
          missingWallet: true,
        }),
      );
      // Second wallet so a naive merge has non-trivial aggregates (matches the
      // "response looked like the merged fixture" observation).
      fixtures.set(
        2,
        emptyFixture({
          buy: { volume: 999, transactions: 50, users: 20 },
          referral: { volume: 12, partnerRefCredit: 3, refCredit: 1, paidRefCredit: 0 },
        }),
      );

      expect(fixtureFor(undefined).missingWallet).toBe(true);
      expect(fixtureFor(undefined).buy.volume).toBe(1099);

      // Wallet QB with no where() — state.walletId stays undefined (the flake condition).
      const qb = createQb('wallet');
      await expect(qb.getRawOne()).resolves.toBeNull();
    });
  });

  // --- Response-path suppression (Block C) --- //

  describe('response-path k-anonymity (getStatistics / getTimeline)', () => {
    it('drops under-k breakdown rows, nulls newUsers in 1..k-1, and never exposes users', async () => {
      fixtures.set(
        1,
        emptyFixture({
          // Totals above k so period totals stay visible — focus on breakdown + newUsers.
          buy: { volume: 1000, transactions: 20, users: 10 },
          sell: { volume: 500, transactions: 15, users: 10 },
          swap: { volume: 200, transactions: 10, users: 8 },
          allTime: { buy: 5000, sell: 1000, registeredUsers: 50, tradingUsers: 20 },
          newUsers: 3, // 1..k-1 → null
          activeUserIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
          namedRows: [
            { name: 'RARE', blockchain: 'Bitcoin', volume: 10, transactions: 2, users: 2 }, // under k
            { name: 'COMMON', blockchain: 'Bitcoin', volume: 500, transactions: 20, users: 12 },
            { name: 'COMMON2', blockchain: 'Ethereum', volume: 400, transactions: 18, users: 11 },
          ],
        }),
      );
      activeUserCountFromManager = 10;

      const result = await service.getStatistics(1, PERIOD_FROM, PERIOD_TO);

      const assetNames = result.breakdown.assets.map((a) => a.name);
      expect(assetNames).not.toContain('RARE');
      expect(assetNames).toContain('COMMON');
      expect(result.totals.newUsers).toBeNull();

      const keys = collectKeys(JSON.parse(JSON.stringify(result)));
      expect(keys.has('users')).toBe(false);
    });

    it('suppresses under-k timeline buckets (suppressed:true, volume null) and strips users', async () => {
      fixtures.set(
        1,
        emptyFixture({
          timelineRows: [
            // Day with 3 txs → under k → suppressed (+ complementary may hit another day)
            { bucket: new Date('2024-06-10T00:00:00.000Z'), volume: 30, transactions: 3, users: 3 },
            { bucket: new Date('2024-06-11T00:00:00.000Z'), volume: 200, transactions: 20, users: 15 },
            { bucket: new Date('2024-06-12T00:00:00.000Z'), volume: 300, transactions: 30, users: 20 },
          ],
        }),
      );

      const result = await service.getTimeline(
        1,
        '2024-06-10T00:00:00.000Z',
        '2024-06-12T23:59:59.000Z',
        PartnerStatisticGranularity.DAY,
      );

      const under = result.buckets.find((b) => b.date.toISOString() === '2024-06-10T00:00:00.000Z');
      expect(under).toBeDefined();
      expect(under!.suppressed).toBe(true);
      expect(under!.volume).toBeNull();
      expect(under!.transactions).toBeNull();

      // At least one more day may be complementary-suppressed; a large day stays visible.
      const large = result.buckets.find((b) => b.date.toISOString() === '2024-06-12T00:00:00.000Z');
      // complementary suppresses the smallest filled remaining (day 11 with 20), day 12 stays
      expect(large!.suppressed).toBe(false);
      expect(large!.volume).not.toBeNull();

      const keys = collectKeys(JSON.parse(JSON.stringify(result)));
      expect(keys.has('users')).toBe(false);
    });
  });

  // --- mergeNamedRows / breakdown pipeline --- //

  describe('mergeNamedRows and breakdown pipeline', () => {
    it('merges same-name rows across directions and takes Math.max of users', async () => {
      fixtures.set(
        1,
        emptyFixture({
          buy: { volume: 500, transactions: 20, users: 10 },
          sell: { volume: 300, transactions: 10, users: 8 },
          allTime: { buy: 500, sell: 300, registeredUsers: 20, tradingUsers: 10 },
          activeUserIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
          namedRows: [
            { name: 'BTC', blockchain: 'Bitcoin', volume: 200, transactions: 10, users: 6 },
            { name: 'BTC', blockchain: 'Bitcoin', volume: 100, transactions: 5, users: 4 },
            { name: 'ETH', blockchain: 'Ethereum', volume: 50, transactions: 5, users: 5 },
            { name: 'CHF', volume: 400, transactions: 15, users: 10 },
          ],
        }),
      );

      const result = await service.getStatistics(1, PERIOD_FROM, PERIOD_TO);

      expect(result.breakdown.fiatCurrencies.length + result.breakdown.blockchains.length).toBeGreaterThan(0);

      const merged = service.mergeNamedRows([
        { name: 'BTC', volume: 200, transactions: 10, users: 6 },
        { name: 'BTC', volume: 100, transactions: 5, users: 4 },
        { name: 'ETH', volume: 50, transactions: 5, users: 5 },
      ]);
      expect(merged.find((r) => r.name === 'BTC')?.volume).toBe(300);
      expect(merged.find((r) => r.name === 'BTC')?.transactions).toBe(15);
      // Math.max(6, 4) = 6 — Math.min would yield 4 and fail this
      expect(merged.find((r) => r.name === 'BTC')?.users).toBe(6);
      expect(merged.find((r) => r.name === 'BTC')?.users).not.toBe(4);
      expect(merged).toHaveLength(2);
    });

    it('drops nameless rows from the breakdown payload', () => {
      const merged = service.mergeNamedRows([
        { name: null, volume: 999, transactions: 50, users: 20 },
        { name: '', volume: 100, transactions: 5, users: 3 },
        { name: 'BTC', volume: 200, transactions: 10, users: 6 },
      ]);
      expect(merged).toHaveLength(1);
      expect(merged[0].name).toBe('BTC');
      expect(merged.find((r) => r.name === null || r.name === '')).toBeUndefined();
      // Nameless volume must not appear under any key
      expect(merged.every((r) => r.volume !== 999)).toBe(true);
    });
  });

  // --- K1: partial edge buckets --- //

  describe('timeline partial edge buckets (K1)', () => {
    it('marks week-edge buckets as partial when from/to cut mid-week', async () => {
      const result = await service.getTimeline(1, MID_WEEK_FROM, MID_WEEK_TO, PartnerStatisticGranularity.WEEK);

      expect(result.buckets.length).toBeGreaterThan(0);
      expect(result.buckets[0].partial).toBe(true);
      expect(result.buckets[result.buckets.length - 1].partial).toBe(true);
    });

    it('marks full day range buckets as non-partial when aligned to midnight span', async () => {
      const result = await service.getTimeline(
        1,
        '2024-06-10T00:00:00.000Z',
        '2024-06-12T23:59:59.000Z',
        PartnerStatisticGranularity.DAY,
      );

      expect(result.buckets.length).toBe(3);
      expect(result.buckets.every((b) => b.partial === false)).toBe(true);
    });
  });

  // --- Timeline collision accumulation (WEEK/MONTH re-bucket of day-truncated SQL rows) --- //

  describe('timeline bucket key collision accumulation', () => {
    it('sums volume/transactions and takes max(users) when two day rows fall into the same week', async () => {
      // Monday + Wednesday of ISO week 2024-06-10..16 → same WEEK key after startOfBucket.
      fixtures.set(
        1,
        emptyFixture({
          timelineRows: [
            { bucket: new Date('2024-06-10T00:00:00.000Z'), volume: 100, transactions: 10, users: 5 },
            { bucket: new Date('2024-06-12T00:00:00.000Z'), volume: 50, transactions: 7, users: 8 },
          ],
        }),
      );

      const map = await service['timelineByDirection'](
        1,
        new Date('2024-06-10T00:00:00.000Z'),
        new Date('2024-06-17T00:00:00.000Z'),
        PartnerStatisticDirection.BUY,
        PartnerStatisticGranularity.WEEK,
      );

      expect(map.size).toBe(1);
      const entry = [...map.values()][0];
      expect(entry.volume).toBe(150);
      expect(entry.transactions).toBe(17);
      expect(entry.users).toBe(8);
      // Not last-write-wins (would be 7/50/8) and not first-write-wins (10/100/5).
      expect(entry.transactions).not.toBe(7);
      expect(entry.transactions).not.toBe(10);
      expect(entry.volume).not.toBe(50);
      expect(entry.volume).not.toBe(100);
    });
  });

  // --- WEEK / MONTH bucket alignment --- //

  describe('startOfBucket and addBucket (WEEK / MONTH)', () => {
    it('snaps Sunday to the Monday before (ISO week) and any day to month start', () => {
      // 2024-06-16 is a Sunday UTC.
      const sunday = new Date('2024-06-16T15:30:00.000Z');
      const weekStart = service['startOfBucket'](sunday, PartnerStatisticGranularity.WEEK);
      expect(weekStart.toISOString()).toBe('2024-06-10T00:00:00.000Z');
      // Wrong Sunday handling (day - 1 without the day===0 ? 6 branch) lands on Saturday 15th.
      expect(weekStart.toISOString()).not.toBe('2024-06-15T00:00:00.000Z');

      const midMonth = new Date('2024-06-15T12:00:00.000Z');
      const monthStart = service['startOfBucket'](midMonth, PartnerStatisticGranularity.MONTH);
      expect(monthStart.toISOString()).toBe('2024-06-01T00:00:00.000Z');
    });

    it('snaps Mon–Sat back to the Monday of that ISO week (not only Sunday)', () => {
      // 2024-06-12 Wednesday → Monday 2024-06-10. Mutation day-1 → day would land on Tuesday.
      const wednesday = new Date('2024-06-12T12:00:00.000Z');
      expect(service['startOfBucket'](wednesday, PartnerStatisticGranularity.WEEK).toISOString()).toBe(
        '2024-06-10T00:00:00.000Z',
      );

      const monday = new Date('2024-06-10T08:00:00.000Z');
      expect(service['startOfBucket'](monday, PartnerStatisticGranularity.WEEK).toISOString()).toBe(
        '2024-06-10T00:00:00.000Z',
      );

      const saturday = new Date('2024-06-15T08:00:00.000Z');
      expect(service['startOfBucket'](saturday, PartnerStatisticGranularity.WEEK).toISOString()).toBe(
        '2024-06-10T00:00:00.000Z',
      );
      // Mutation `day === 0 ? 6 : day` (drop the −1) would snap Saturday to Friday 14th.
      expect(service['startOfBucket'](saturday, PartnerStatisticGranularity.WEEK).toISOString()).not.toBe(
        '2024-06-14T00:00:00.000Z',
      );
    });

    it('addBucket advances WEEK by 7 days and MONTH across a month boundary', () => {
      const monday = new Date('2024-06-10T00:00:00.000Z');
      expect(service['addBucket'](monday, PartnerStatisticGranularity.WEEK).toISOString()).toBe(
        '2024-06-17T00:00:00.000Z',
      );

      const jan = new Date('2024-01-01T00:00:00.000Z');
      expect(service['addBucket'](jan, PartnerStatisticGranularity.MONTH).toISOString()).toBe(
        '2024-02-01T00:00:00.000Z',
      );

      const dec = new Date('2024-12-01T00:00:00.000Z');
      expect(service['addBucket'](dec, PartnerStatisticGranularity.MONTH).toISOString()).toBe(
        '2025-01-01T00:00:00.000Z',
      );
    });
  });

  // --- TIMEZONE INDEPENDENCE --- //

  describe('timezone independence of timeline buckets', () => {
    it('emits exactly three UTC day buckets for a known three-day period (regression for local TZ drift)', async () => {
      const result = await service.getTimeline(
        1,
        '2024-06-10T00:00:00.000Z',
        '2024-06-12T23:59:59.000Z',
        PartnerStatisticGranularity.DAY,
      );

      expect(result.buckets).toHaveLength(3);
      expect(result.buckets.map((b) => b.date.toISOString())).toEqual([
        '2024-06-10T00:00:00.000Z',
        '2024-06-11T00:00:00.000Z',
        '2024-06-12T00:00:00.000Z',
      ]);
      expect(result.period.from.toISOString()).toBe('2024-06-10T00:00:00.000Z');
      expect(result.period.to.toISOString()).toBe('2024-06-13T00:00:00.000Z');
    });

    it('binds DATE_TRUNC to UTC in the timeline SQL expression', async () => {
      await service.getTimeline(
        1,
        '2024-06-10T00:00:00.000Z',
        '2024-06-12T23:59:59.000Z',
        PartnerStatisticGranularity.DAY,
      );

      // getTimeline fans out BUY/SELL/SWAP; each timelineByDirection groupBy's DATE_TRUNC once
      // and nothing else. Filtering to DATE_TRUNC survivors then pinning length missed an
      // extra .addGroupBy('tx.id') (COUNT(DISTINCT user.id) collapses to 1 per tx row).
      // Multiset: order of the three direction tasks is not a product contract.
      const TIMELINE_GROUP_BY = "DATE_TRUNC('day', tx.created) AT TIME ZONE 'UTC'";
      expectMultisetEqual(groupByCapture.groupBys, [TIMELINE_GROUP_BY, TIMELINE_GROUP_BY, TIMELINE_GROUP_BY]);
      for (const g of groupByCapture.groupBys) {
        expect(g).toContain("AT TIME ZONE 'UTC'");
        // SQL unit is lowercase via PartnerStatisticDateTruncUnit, not the PascalCase API value.
        expect(g).toMatch(/DATE_TRUNC\('day',\s*tx\.created\)/);
      }
    });
  });

  // --- TIMELINE VALIDATION PATH --- //

  describe('getTimeline validation', () => {
    it('throws 400 for invalid granularity', async () => {
      await expect(
        service.getTimeline(1, PERIOD_FROM, PERIOD_TO, 'hour' as PartnerStatisticGranularity),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 400 for period over max days', async () => {
      const from = new Date(TEST_NOW.getTime() - (PARTNER_STATISTIC_MAX_PERIOD_DAYS + 100) * 24 * 3600 * 1000);
      await expect(service.getTimeline(1, from, TEST_NOW, PartnerStatisticGranularity.DAY)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // --- HALF-OPEN INTERVAL --- //

  describe('half-open period filter', () => {
    it('uses >= from AND < to on every created filter (not BETWEEN inclusive)', async () => {
      fixtures.set(
        1,
        emptyFixture({
          buy: { volume: 100, transactions: 10, users: 5 },
          allTime: { buy: 100, sell: 0, registeredUsers: 10, tradingUsers: 5 },
          activeUserIds: [1, 2, 3, 4, 5],
        }),
      );

      await service.getStatistics(1, PERIOD_FROM, PERIOD_TO);

      // Clause text + bound values (expectPeriodBoundsMatchResolved). Clause-only pins missed
      // `from: new Date(0)` while the SQL string stayed identical.
      expectPeriodBoundsMatchResolved();
      // No BETWEEN and no exclusive-open left bound on any created-related clause that survived.
      const createdRelated = whereClauses.filter((c) => /created/i.test(c));
      expect(createdRelated).toHaveLength(GET_STATISTICS_CLAUSE_BUDGET.PERIOD_FILTERS);
      expect(createdRelated.every((c) => !/BETWEEN/i.test(c))).toBe(true);
      // Same total pin as wallet-scope isolation: an extra unscoped WHERE slips past 18 alone.
      expect(whereClauses).toHaveLength(GET_STATISTICS_CLAUSE_BUDGET.WHERE_CLAUSES);
      expectActiveUserUnionShape();
    });
  });

  // --- CONCURRENCY CAP (D1) --- //

  describe('query concurrency cap spans nested fan-outs (D1)', () => {
    it(`keeps simultaneous SQL executions ≤ ${PARTNER_STATISTIC_QUERY_CONCURRENCY}`, async () => {
      fixtures.set(
        1,
        emptyFixture({
          buy: { volume: 1000, transactions: 20, users: 10 },
          sell: { volume: 500, transactions: 15, users: 10 },
          swap: { volume: 200, transactions: 10, users: 8 },
          allTime: { buy: 5000, sell: 1000, registeredUsers: 50, tradingUsers: 20 },
          newUsers: 8,
          activeUserIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
          namedRows: [{ name: 'BTC', blockchain: 'Bitcoin', volume: 200, transactions: 10, users: 8 }],
        }),
      );
      activeUserCountFromManager = 10;
      queryDelayMs = 15;

      await service.getStatistics(1, PERIOD_FROM, PERIOD_TO);

      expect(maxConcurrentQueries).toBeGreaterThan(1);
      expect(maxConcurrentQueries).toBeLessThanOrEqual(PARTNER_STATISTIC_QUERY_CONCURRENCY);
    });
  });

  // --- NaN guard (D5) --- //

  describe('non-numeric aggregates (D5)', () => {
    it('throws instead of turning NaN into JSON null', async () => {
      fixtures.set(
        1,
        emptyFixture({
          buy: { volume: 100, transactions: 10, users: 5 },
          allTime: { buy: 100, sell: 0, registeredUsers: 10, tradingUsers: 5 },
          activeUserIds: [1, 2, 3, 4, 5],
        }),
      );
      nonNumericVolume = 'not-a-number';

      await expect(service.getStatistics(1, PERIOD_FROM, PERIOD_TO)).rejects.toThrow(/non-numeric volume/);
    });

    it('toCount rejects non-numeric values instead of producing NaN', () => {
      expect(() => service['toCount']('not-a-number')).toThrow(/non-numeric count/);
      // Driver could return an unexpected non-primitive; coerce path still NaNs.
      expect(() => service['toCount']({} as unknown as string)).toThrow(/non-numeric count/);
    });
  });

  // --- Granularity default (Swagger documents Day) --- //

  describe('getTimeline granularity default', () => {
    it('defaults to Day when granularity is omitted', async () => {
      const result = await service.getTimeline(1, '2024-06-10T00:00:00.000Z', '2024-06-12T23:59:59.000Z');
      expect(result.granularity).toBe(PartnerStatisticGranularity.DAY);
      expect(result.granularity).not.toBe(PartnerStatisticGranularity.MONTH);
      expect(result.granularity).not.toBe(PartnerStatisticGranularity.WEEK);
      // Day buckets: 10, 11, 12 — Month would collapse to one
      expect(result.buckets.length).toBe(3);
    });
  });

  // --- Query gate release on error --- //

  describe('query concurrency gate release on error', () => {
    it('releases the semaphore slot when a query rejects so later work is not starved', async () => {
      fixtures.set(
        1,
        emptyFixture({
          buy: { volume: 100, transactions: 10, users: 5 },
          allTime: { buy: 100, sell: 0, registeredUsers: 10, tradingUsers: 5 },
          activeUserIds: [1, 2, 3, 4, 5],
        }),
      );
      nonNumericVolume = 'not-a-number';

      await expect(service.getStatistics(1, PERIOD_FROM, PERIOD_TO)).rejects.toThrow(/non-numeric volume/);

      // Gate must be free again: a subsequent request must complete (not hang on a full semaphore).
      nonNumericVolume = false;
      fixtures.set(
        1,
        emptyFixture({
          buy: { volume: 500, transactions: 20, users: 10 },
          allTime: { buy: 500, sell: 0, registeredUsers: 20, tradingUsers: 10 },
          activeUserIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        }),
      );
      activeUserCountFromManager = 10;

      await expect(service.getStatistics(1, PERIOD_FROM, PERIOD_TO)).resolves.toMatchObject({
        currency: 'CHF',
      });
    });
  });
});
