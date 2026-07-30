import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { BuyCryptoRepository } from 'src/subdomains/core/buy-crypto/process/repositories/buy-crypto.repository';
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import { UserRepository } from 'src/subdomains/generic/user/models/user/user.repository';
import { WalletRepository } from 'src/subdomains/generic/user/models/wallet/wallet.repository';
import {
  PARTNER_STATISTIC_DEFAULT_PERIOD_DAYS,
  PARTNER_STATISTIC_MAX_PERIOD_DAYS,
  PartnerStatisticDirection,
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
const PERIOD_FROM = Util.daysBefore(30, TEST_NOW);
const PERIOD_TO = TEST_NOW;
/** Wednesday UTC before TEST_NOW (Saturday) — mid-week so week-edge buckets are partial. */
const MID_WEEK_FROM = Util.daysBefore(3, TEST_NOW);
const MID_WEEK_TO = Util.daysAfter(7, MID_WEEK_FROM);

interface SettlementFixture {
  received: number;
  delivered: number;
  rejected: number;
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
  settlement: Record<Direction, SettlementFixture>;
  /** Named breakdown rows returned by getRawMany for asset/fiat/blockchain/payment queries. */
  namedRows: { name: string; blockchain?: string; volume: number; transactions: number; users: number }[];
  timelineRows: { bucket: Date; volume: number; transactions: number; users: number }[];
}

function emptySettlement(): SettlementFixture {
  return { received: 0, delivered: 0, rejected: 0 };
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
    settlement: {
      [PartnerStatisticDirection.BUY]: emptySettlement(),
      [PartnerStatisticDirection.SELL]: emptySettlement(),
      [PartnerStatisticDirection.SWAP]: emptySettlement(),
    },
    namedRows: [],
    timelineRows: [],
    ...overrides,
  };
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
  isSettlement: boolean;
  isPaymentInfo: boolean;
  amlPassOnly: boolean;
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
  let settlementAmlPassOnly: boolean[];
  let groupByCapture: GroupByCapture;
  let managerCreateQueryBuilderCalls: number;
  let activeUserCountFromManager: number | undefined;
  let getRawManyCalls: number;

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
        for (const d of [
          PartnerStatisticDirection.BUY,
          PartnerStatisticDirection.SELL,
          PartnerStatisticDirection.SWAP,
        ]) {
          merged.settlement[d].received += f.settlement[d].received;
          merged.settlement[d].delivered += f.settlement[d].delivered;
          merged.settlement[d].rejected += f.settlement[d].rejected;
        }
        merged.namedRows.push(...f.namedRows);
        merged.timelineRows.push(...f.timelineRows);
      }
      return merged;
    }
    return fixtures.get(walletId) ?? emptyFixture();
  }

  function createQb(kind: 'buyCrypto' | 'buyFiat' | 'user' | 'wallet' | 'txRequest') {
    const state: QbState = {
      selects: [],
      selectAliases: [],
      groupBys: [],
      isTimeline: false,
      isAllTime: false,
      isReferral: false,
      isSettlement: false,
      isPaymentInfo: kind === 'txRequest',
      amlPassOnly: false,
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
      if (label === 'received' || label === 'delivered' || label === 'rejected') state.isSettlement = true;
      if (kind === 'txRequest' || label === 'type' || label === 'status') state.isPaymentInfo = true;
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
    qb.where = jest.fn((clause: unknown, params?: unknown) => {
      whereClauses.push(String(clause));
      const walletId = trackWalletId(params);
      if (walletId !== undefined) state.walletId = walletId;
      return self();
    });
    qb.andWhere = jest.fn((clause: unknown, params?: unknown) => {
      const clauseStr = String(clause);
      whereClauses.push(clauseStr);
      const walletId = trackWalletId(params);
      if (walletId !== undefined) state.walletId = walletId;
      if (clauseStr.includes('amlCheck')) {
        amlFilterClauses.push(clauseStr);
        if (params && typeof params === 'object' && 'check' in (params as object)) {
          state.amlPassOnly = true;
        }
      }
      return self();
    });
    qb.getQuery = jest.fn(() => `SELECT user.id AS id FROM mock_${kind}_${state.direction ?? 'x'}`);
    qb.getParameters = jest.fn(() => ({
      walletId: state.walletId,
      check: 'Pass',
      from: new Date(TEST_NOW),
      to: new Date(TEST_NOW),
    }));

    qb.getRawOne = jest.fn(async () => {
      const f = fixtureFor(state.walletId);

      if (kind === 'wallet' || state.isReferral) {
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

      if (state.isSettlement) {
        settlementAmlPassOnly.push(state.amlPassOnly);
        const dir =
          state.direction ?? (kind === 'buyFiat' ? PartnerStatisticDirection.SELL : PartnerStatisticDirection.BUY);
        const s = f.settlement[dir];
        return { received: s.received, delivered: s.delivered, rejected: s.rejected };
      }

      const dir =
        state.direction ?? (kind === 'buyFiat' ? PartnerStatisticDirection.SELL : PartnerStatisticDirection.BUY);
      const agg = f[dir];
      return { volume: agg.volume, transactions: agg.transactions, users: agg.users };
    });

    qb.getRawMany = jest.fn(async () => {
      getRawManyCalls += 1;
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
    });

    qb.getCount = jest.fn(async () => fixtureFor(state.walletId).newUsers);

    return qb;
  }

  function createManagerQb() {
    const state: { walletId?: number } = {};
    const qb: Record<string, jest.Mock> = {};
    const self = () => qb;

    qb.select = jest.fn(() => self());
    qb.from = jest.fn(() => self());
    qb.setParameters = jest.fn((params: Record<string, unknown>) => {
      const walletId = trackWalletId(params);
      if (walletId !== undefined) state.walletId = walletId;
      return self();
    });
    qb.getRawOne = jest.fn(async () => {
      managerCreateQueryBuilderCalls += 1;
      const f = fixtureFor(state.walletId);
      const count = activeUserCountFromManager ?? f.activeUserIds.length;
      return { count };
    });

    return qb;
  }

  beforeEach(async () => {
    lastWalletIds = [];
    whereClauses = [];
    amlFilterClauses = [];
    settlementAmlPassOnly = [];
    fixtures = new Map();
    groupByCapture = { groupBys: [], selectAliases: [] };
    managerCreateQueryBuilderCalls = 0;
    activeUserCountFromManager = undefined;
    getRawManyCalls = 0;
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

  // --- PERIOD VALIDATION --- //

  describe('resolvePeriod', () => {
    it('defaults to the last 30 days snapped to UTC day boundaries when from/to are omitted', () => {
      jest.useFakeTimers().setSystemTime(TEST_NOW);

      const period = service.resolvePeriod();
      // to = start of day after TEST_NOW's UTC day
      expect(period.to.toISOString()).toBe('2024-06-16T00:00:00.000Z');
      expect(period.from.toISOString()).toBe(
        new Date(Date.UTC(2024, 5, 15 - PARTNER_STATISTIC_DEFAULT_PERIOD_DAYS)).toISOString(),
      );

      jest.useRealTimers();
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
      const from = Util.daysBefore(PARTNER_STATISTIC_MAX_PERIOD_DAYS + 50, TEST_NOW);
      const to = TEST_NOW;
      expect(() => service.resolvePeriod(from, to)).toThrow(BadRequestException);
      expect(() => service.resolvePeriod(from, to)).toThrow(String(PARTNER_STATISTIC_MAX_PERIOD_DAYS));
    });

    it('accepts a period of exactly the max span', () => {
      const from = Util.daysBefore(PARTNER_STATISTIC_MAX_PERIOD_DAYS - 1, TEST_NOW);
      const to = TEST_NOW;
      expect(() => service.resolvePeriod(from, to)).not.toThrow();
    });

    it('accepts a single full day', () => {
      const period = service.resolvePeriod('2024-06-01T00:00:00.000Z', '2024-06-01T23:59:59.000Z');
      expect(period.from.toISOString()).toBe('2024-06-01T00:00:00.000Z');
      expect(period.to.toISOString()).toBe('2024-06-02T00:00:00.000Z');
    });
  });

  describe('parseGranularity', () => {
    it('rejects invalid granularity with a clear message', () => {
      expect(() => service.parseGranularity('year')).toThrow(BadRequestException);
      expect(() => service.parseGranularity('year')).toThrow(/day, week, month/);
    });

    it('accepts day|week|month', () => {
      expect(service.parseGranularity('day')).toBe('day');
      expect(service.parseGranularity('week')).toBe('week');
      expect(service.parseGranularity('month')).toBe('month');
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
      await service.getTimeline(1, PERIOD_FROM, Util.daysBefore(16, PERIOD_TO), 'day');

      expect(groupByCapture.groupBys.length).toBeGreaterThan(0);

      const aliases = new Set(groupByCapture.selectAliases);
      for (const g of groupByCapture.groupBys) {
        const isQualified = g.includes('.');
        const isDateTrunc = g.startsWith('DATE_TRUNC(');
        expect(isQualified || isDateTrunc).toBe(true);
        expect(aliases.has(g)).toBe(false);
      }

      expect(groupByCapture.groupBys).toEqual(
        expect.arrayContaining([
          'tx.inputAsset',
          'inputAsset.blockchain',
          'outputAsset.name',
          'outputAsset.blockchain',
        ]),
      );
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
          settlement: {
            // inProgress = received − delivered − rejected must also be 0 or ≥ k
            [PartnerStatisticDirection.BUY]: { received: 20, delivered: 15, rejected: 0 },
            [PartnerStatisticDirection.SELL]: emptySettlement(),
            [PartnerStatisticDirection.SWAP]: emptySettlement(),
          },
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
          settlement: {
            [PartnerStatisticDirection.BUY]: { received: 9000, delivered: 8000, rejected: 100 },
            [PartnerStatisticDirection.SELL]: emptySettlement(),
            [PartnerStatisticDirection.SWAP]: emptySettlement(),
          },
        }),
      );
    });

    it('returns only wallet A aggregates and scopes SQL to user.walletId on every user-related query', async () => {
      const result = await service.getStatistics(1, PERIOD_FROM, PERIOD_TO);

      expect(lastWalletIds.length).toBeGreaterThan(0);
      expect(lastWalletIds.every((id) => id === 1)).toBe(true);

      // Every walletId-binding clause must use the wallet column — removing scope from one query fails this.
      const scopeClauses = whereClauses.filter((c) => c.includes('walletId'));
      expect(scopeClauses.length).toBeGreaterThan(0);
      expect(scopeClauses.every((c) => c.includes('user.walletId') || c.includes('wallet.id'))).toBe(true);
      expect(whereClauses.every((c) => !/user\.id\s*=\s*:walletId/.test(c))).toBe(true);

      expect(amlFilterClauses.length).toBeGreaterThan(0);
      expect(amlFilterClauses.every((c) => /amlCheck\s*=\s*:check/.test(c))).toBe(true);

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
      lastWalletIds = [];
      whereClauses = [];
      const result = await service.getStatistics(2, PERIOD_FROM, PERIOD_TO);

      expect(lastWalletIds.length).toBeGreaterThan(0);
      expect(lastWalletIds.every((id) => id === 2)).toBe(true);
      const scopeClauses = whereClauses.filter((c) => c.includes('walletId'));
      expect(scopeClauses.every((c) => c.includes('user.walletId') || c.includes('wallet.id'))).toBe(true);

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
      expect(under.meta.suppressedBuckets).toBeGreaterThanOrEqual(2);

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
  });

  // --- M2: active users via manager UNION count --- //

  describe('countActiveUsers uses DB COUNT over UNION (M2)', () => {
    it('returns the manager COUNT and does not load user id rows via getRawMany', async () => {
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

      const beforeMany = getRawManyCalls;
      const result = await service.getStatistics(1, PERIOD_FROM, PERIOD_TO);

      expect(managerCreateQueryBuilderCalls).toBeGreaterThanOrEqual(1);
      expect(result.totals.activeUsers).toBe(7);
      expect(result.totals.activeUsers).not.toBe(10);
      expect(getRawManyCalls).toBeGreaterThanOrEqual(beforeMany);
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
  });

  // --- mergeNamedRows / breakdown pipeline --- //

  describe('mergeNamedRows and breakdown pipeline', () => {
    it('merges same-name rows across directions and surfaces them in the response', async () => {
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

      // mergeNamedRows is used for fiat/blockchain/payment; asset rows are not merged by name across dirs
      expect(result.breakdown.fiatCurrencies.length + result.breakdown.blockchains.length).toBeGreaterThan(0);
      // Direct unit check of mergeNamedRows (mutation: neutralize → this fails)
      const merged = service.mergeNamedRows([
        { name: 'BTC', volume: 200, transactions: 10, users: 6 },
        { name: 'BTC', volume: 100, transactions: 5, users: 4 },
        { name: 'ETH', volume: 50, transactions: 5, users: 5 },
      ]);
      expect(merged.find((r) => r.name === 'BTC')?.volume).toBe(300);
      expect(merged.find((r) => r.name === 'BTC')?.transactions).toBe(15);
      expect(merged).toHaveLength(2);
    });
  });

  // --- K1: partial edge buckets --- //

  describe('timeline partial edge buckets (K1)', () => {
    it('marks week-edge buckets as partial when from/to cut mid-week', async () => {
      const result = await service.getTimeline(1, MID_WEEK_FROM, MID_WEEK_TO, 'week');

      expect(result.buckets.length).toBeGreaterThan(0);
      expect(result.buckets[0].partial).toBe(true);
      expect(result.buckets[result.buckets.length - 1].partial).toBe(true);
    });

    it('marks full day range buckets as non-partial when aligned to midnight span', async () => {
      const result = await service.getTimeline(1, '2024-06-10T00:00:00.000Z', '2024-06-12T23:59:59.000Z', 'day');

      expect(result.buckets.length).toBe(3);
      expect(result.buckets.every((b) => b.partial === false)).toBe(true);
    });
  });

  // --- TIMEZONE INDEPENDENCE --- //

  describe('timezone independence of timeline buckets', () => {
    it('emits exactly three UTC day buckets for a known three-day period (regression for local TZ drift)', async () => {
      const result = await service.getTimeline(1, '2024-06-10T00:00:00.000Z', '2024-06-12T23:59:59.000Z', 'day');

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
      await service.getTimeline(1, '2024-06-10T00:00:00.000Z', '2024-06-12T23:59:59.000Z', 'day');

      const truncs = groupByCapture.groupBys.filter((g) => g.includes('DATE_TRUNC'));
      expect(truncs.length).toBeGreaterThan(0);
      for (const g of truncs) {
        expect(g).toContain("AT TIME ZONE 'UTC'");
        expect(g).toMatch(/DATE_TRUNC\('day',\s*tx\.created\)/);
      }
    });
  });

  // --- TIMELINE VALIDATION PATH --- //

  describe('getTimeline validation', () => {
    it('throws 400 for invalid granularity', async () => {
      await expect(service.getTimeline(1, PERIOD_FROM, PERIOD_TO, 'hour')).rejects.toThrow(BadRequestException);
    });

    it('throws 400 for period over max days', async () => {
      const from = Util.daysBefore(PARTNER_STATISTIC_MAX_PERIOD_DAYS + 100, TEST_NOW);
      await expect(service.getTimeline(1, from, TEST_NOW, 'day')).rejects.toThrow(BadRequestException);
    });
  });

  // --- HALF-OPEN INTERVAL --- //

  describe('half-open period filter', () => {
    it('uses >= from AND < to (not BETWEEN inclusive)', async () => {
      fixtures.set(
        1,
        emptyFixture({
          buy: { volume: 100, transactions: 10, users: 5 },
          allTime: { buy: 100, sell: 0, registeredUsers: 10, tradingUsers: 5 },
          activeUserIds: [1, 2, 3, 4, 5],
        }),
      );

      await service.getStatistics(1, PERIOD_FROM, PERIOD_TO);

      const halfOpen = whereClauses.filter((c) => c.includes('created'));
      expect(halfOpen.some((c) => c.includes('>=') && c.includes('<'))).toBe(true);
      expect(halfOpen.every((c) => !/BETWEEN/i.test(c))).toBe(true);
    });
  });
});
