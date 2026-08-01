import { AsyncLocalStorage } from 'async_hooks';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { BuyCryptoRepository } from 'src/subdomains/core/buy-crypto/process/repositories/buy-crypto.repository';
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import { UserRepository } from 'src/subdomains/generic/user/models/user/user.repository';
import { WalletRepository } from 'src/subdomains/generic/user/models/wallet/wallet.repository';
import { TransactionSourceType } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { SelectQueryBuilder } from 'typeorm';
import { BuyCrypto } from '../buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from '../sell-crypto/process/buy-fiat.entity';
import {
  PartnerAssetBreakdownDto,
  PartnerNamedBreakdownDto,
  PartnerReferralDto,
  PartnerStatisticDto,
  PartnerTimelineBucketDto,
  PartnerTimelineDto,
} from './dto/partner-statistic.dto';
import {
  PARTNER_STATISTIC_DEFAULT_PERIOD_DAYS,
  PARTNER_STATISTIC_MAX_PERIOD_DAYS,
  PARTNER_STATISTIC_QUERY_CONCURRENCY,
  PARTNER_STATISTIC_SUPPRESSION_THRESHOLD,
  PartnerPaymentMethodMap,
  PartnerStatisticDateTruncUnit,
  PartnerStatisticDirection,
  PartnerStatisticGranularity,
} from './partner-statistic.enum';
import {
  suppressAllTimeVolume,
  suppressBreakdownRows,
  suppressPeriodTotals,
  suppressScalar,
  suppressTimelineBuckets,
} from './partner-statistic.suppression';

type Direction = PartnerStatisticDirection;

interface AggregateRow {
  volume: string | number | null;
  transactions: string | number | null;
  users: string | number | null;
}

interface NamedAggregateRow extends AggregateRow {
  name: string | null;
  blockchain?: string | null;
}

interface TimelineRawRow {
  bucket: Date | string;
  volume: string | number | null;
  transactions: string | number | null;
  users: string | number | null;
}

interface DirectionAgg {
  volume: number;
  transactions: number;
  users: number;
}

/**
 * Per-request semaphore for actual SQL executions. Nested fan-outs share one gate so the
 * concurrency cap applies to queries, not to each runAll call site.
 */
class QueryConcurrencyGate {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

@Injectable()
export class PartnerStatisticService {
  /** Request-scoped query gate (set for the duration of getStatistics / getTimeline). */
  private static readonly queryGateAls = new AsyncLocalStorage<QueryConcurrencyGate>();

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyFiatRepo: BuyFiatRepository,
    private readonly userRepo: UserRepository,
    private readonly walletRepo: WalletRepository,
  ) {}

  // --- PUBLIC API --- //

  async getStatistics(walletId: number, from?: string | Date, to?: string | Date): Promise<PartnerStatisticDto> {
    return this.withQueryGate(async () => {
      const period = this.resolvePeriod(from, to);

      const [
        buyAgg,
        sellAgg,
        swapAgg,
        activeUsersRaw,
        newUsersRaw,
        allTimeRaw,
        referralRaw,
        assetRows,
        fiatRows,
        blockchainRows,
        paymentMethodRows,
      ] = await this.runAll([
        () => this.aggregateByDirection(walletId, period.from, period.to, PartnerStatisticDirection.BUY),
        () => this.aggregateByDirection(walletId, period.from, period.to, PartnerStatisticDirection.SELL),
        () => this.aggregateByDirection(walletId, period.from, period.to, PartnerStatisticDirection.SWAP),
        () => this.countActiveUsers(walletId, period.from, period.to),
        () => this.countNewUsers(walletId, period.from, period.to),
        () => this.getAllTime(walletId),
        () => this.getReferralRaw(walletId),
        () => this.aggregateAssets(walletId, period.from, period.to),
        () => this.aggregateFiatCurrencies(walletId, period.from, period.to),
        () => this.aggregateBlockchains(walletId, period.from, period.to),
        () => this.aggregatePaymentMethods(walletId, period.from, period.to),
      ]);

      const rawVolume = {
        buy: buyAgg.volume,
        sell: sellAgg.volume,
        swap: swapAgg.volume,
        total: Util.round(buyAgg.volume + sellAgg.volume + swapAgg.volume, Config.defaultVolumeDecimal),
      };
      const rawTransactions = {
        buy: buyAgg.transactions,
        sell: sellAgg.transactions,
        swap: swapAgg.transactions,
        total: buyAgg.transactions + sellAgg.transactions + swapAgg.transactions,
      };
      const rawUsers = {
        buy: buyAgg.users,
        sell: sellAgg.users,
        swap: swapAgg.users,
        total: activeUsersRaw,
      };

      const totalsSuppressed = suppressPeriodTotals(rawVolume, rawTransactions, rawUsers);
      const averageTransactionVolume =
        totalsSuppressed.averageTransactionVolume != null
          ? Util.round(totalsSuppressed.averageTransactionVolume, Config.defaultVolumeDecimal)
          : null;

      const tradingUsersSuppressed = suppressScalar(allTimeRaw.tradingUsers);
      const allTimeSuppressed = suppressAllTimeVolume(allTimeRaw.volume, allTimeRaw.tradingUsers);
      const referral = this.applyReferralSuppression(referralRaw, allTimeRaw.tradingUsers);

      const assets = suppressBreakdownRows(assetRows);
      const fiatCurrencies = suppressBreakdownRows(fiatRows);
      const blockchains = suppressBreakdownRows(blockchainRows);
      const paymentMethods = suppressBreakdownRows(paymentMethodRows);

      const activeUsers = suppressScalar(activeUsersRaw);
      const newUsers = suppressScalar(newUsersRaw);

      const suppressedCount =
        assets.suppressedCount +
        fiatCurrencies.suppressedCount +
        blockchains.suppressedCount +
        paymentMethods.suppressedCount +
        totalsSuppressed.suppressedCount +
        allTimeSuppressed.suppressedCount +
        (activeUsers === null ? 1 : 0) +
        (newUsers === null ? 1 : 0) +
        (tradingUsersSuppressed === null ? 1 : 0) +
        (referral.volume === null && referralRaw.volume !== 0 ? 1 : 0);

      return {
        period,
        currency: 'CHF',
        totals: {
          volume: totalsSuppressed.volume,
          transactions: totalsSuppressed.transactions,
          averageTransactionVolume,
          activeUsers,
          newUsers,
        },
        allTime: {
          volume: allTimeSuppressed.volume,
          registeredUsers: allTimeRaw.registeredUsers,
          tradingUsers: tradingUsersSuppressed,
        },
        breakdown: {
          assets: assets.rows.map(({ users: _u, ...row }) => row),
          fiatCurrencies: fiatCurrencies.rows.map(({ users: _u, ...row }) => row),
          blockchains: blockchains.rows.map(({ users: _u, ...row }) => row),
          paymentMethods: paymentMethods.rows.map(({ users: _u, ...row }) => row),
        },
        referral,
        meta: {
          suppressionThreshold: PARTNER_STATISTIC_SUPPRESSION_THRESHOLD,
          suppressedCount,
          generatedAt: new Date(),
        },
      };
    });
  }

  async getTimeline(
    walletId: number,
    from?: string | Date,
    to?: string | Date,
    granularity: PartnerStatisticGranularity = PartnerStatisticGranularity.DAY,
  ): Promise<PartnerTimelineDto> {
    return this.withQueryGate(async () => {
      const resolvedGranularity = this.parseGranularity(granularity);
      const period = this.resolvePeriod(from, to);

      const [buyRows, sellRows, swapRows] = await this.runAll([
        () =>
          this.timelineByDirection(
            walletId,
            period.from,
            period.to,
            PartnerStatisticDirection.BUY,
            resolvedGranularity,
          ),
        () =>
          this.timelineByDirection(
            walletId,
            period.from,
            period.to,
            PartnerStatisticDirection.SELL,
            resolvedGranularity,
          ),
        () =>
          this.timelineByDirection(
            walletId,
            period.from,
            period.to,
            PartnerStatisticDirection.SWAP,
            resolvedGranularity,
          ),
      ]);

      const filled = this.fillTimelineGaps(period.from, period.to, resolvedGranularity, buyRows, sellRows, swapRows);
      const { buckets, suppressedCount } = suppressTimelineBuckets(filled);

      // Drop internal users field from the public payload.
      const publicBuckets: PartnerTimelineBucketDto[] = buckets.map(({ users: _u, ...rest }) => rest);

      return {
        period,
        currency: 'CHF',
        granularity: resolvedGranularity,
        buckets: publicBuckets,
        meta: {
          suppressionThreshold: PARTNER_STATISTIC_SUPPRESSION_THRESHOLD,
          suppressedCount,
        },
      };
    });
  }

  // --- PERIOD / VALIDATION --- //

  /**
   * Snaps `from`/`to` to UTC day boundaries (half-open [from, to)), enforces max span.
   * Accepts ISO strings or Date; parsing lives here so the controller stays free of date logic.
   * Min span of one day follows from the day snap plus the `fromDay >= toExclusive` rejection —
   * after those two steps the remaining difference is always ≥ 1 day.
   *
   * Default period (when `from`/`to` omitted): the last
   * {@link PARTNER_STATISTIC_DEFAULT_PERIOD_DAYS} **inclusive** UTC calendar days ending on
   * the resolved `to` day — computed with UTC arithmetic only (not process-local `setDate`).
   */
  resolvePeriod(from?: string | Date, to?: string | Date): { from: Date; to: Date } {
    const resolvedTo = this.parseDate(to) ?? new Date();
    const toDayStart = this.startOfUtcDay(resolvedTo);
    const toExclusive = this.addUtcDays(toDayStart, 1);

    // Inclusive lookback: N calendar days ending on toDay ⇒ from = toDay − (N − 1).
    // Pure UTC — never Util.daysBefore (local setDate drifts under non-UTC process TZ).
    const defaultFromDay = this.addUtcDays(toDayStart, -(PARTNER_STATISTIC_DEFAULT_PERIOD_DAYS - 1));
    const fromDay = this.startOfUtcDay(this.parseDate(from) ?? defaultFromDay);

    if (fromDay.getTime() >= toExclusive.getTime()) {
      throw new BadRequestException('From must be before to');
    }

    const spanDays = (toExclusive.getTime() - fromDay.getTime()) / (24 * 3600 * 1000);
    if (spanDays > PARTNER_STATISTIC_MAX_PERIOD_DAYS) {
      throw new BadRequestException(
        `Period must not exceed ${PARTNER_STATISTIC_MAX_PERIOD_DAYS} days (got ${Math.ceil(spanDays)})`,
      );
    }

    return { from: fromDay, to: toExclusive };
  }

  parseGranularity(value: string): PartnerStatisticGranularity {
    const allowed = Object.values(PartnerStatisticGranularity) as string[];
    if (!allowed.includes(value)) {
      throw new BadRequestException(`Invalid granularity '${value}'. Allowed: ${allowed.join(', ')}`);
    }
    return value as PartnerStatisticGranularity;
  }

  /**
   * Accepts only unambiguous UTC-stable forms so process TZ cannot shift the day:
   * - pure calendar date `YYYY-MM-DD` (ES Date parses this as UTC midnight), or
   * - full ISO-8601 timestamp with explicit `Z` or numeric offset.
   * Bare local-looking timestamps (`…T00:00:00` without Z/offset), free text, and
   * numeric strings are rejected — `new Date(value)` would silently apply process TZ.
   * Non-existent calendar days (`2024-06-31`, `2023-02-29`) are rejected even when
   * `new Date` would silently roll them into the next month.
   */
  parseDate(value?: string | Date): Date | undefined {
    if (value == null || value === '') return undefined;
    if (value instanceof Date) {
      if (isNaN(value.getTime())) throw new BadRequestException('Invalid date');
      return value;
    }

    const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
    // ISO-8601 datetime with mandatory Z or ±HH:MM / ±HHMM offset (minutes required for HHMM form).
    const isoWithTz = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}(?::?\d{2}))$/;

    if (!dateOnly.test(value) && !isoWithTz.test(value)) {
      throw new BadRequestException(
        `Invalid date '${value}'. Expected YYYY-MM-DD or an ISO-8601 timestamp with Z or offset (e.g. 2024-06-15T12:00:00.000Z)`,
      );
    }

    // Reject non-existent calendar days before Date's rollover (June 31 → July 1).
    // Applied to both accepted forms via the shared YYYY-MM-DD prefix.
    const y = Number(value.slice(0, 4));
    const m = Number(value.slice(5, 7));
    const d = Number(value.slice(8, 10));
    const calendarCheck = new Date(Date.UTC(y, m - 1, d));
    if (
      calendarCheck.getUTCFullYear() !== y ||
      calendarCheck.getUTCMonth() + 1 !== m ||
      calendarCheck.getUTCDate() !== d
    ) {
      throw new BadRequestException(
        `Invalid date '${value}'. Expected YYYY-MM-DD or an ISO-8601 timestamp with Z or offset (e.g. 2024-06-15T12:00:00.000Z)`,
      );
    }

    const date = new Date(value);
    // Still needed for out-of-range time components (e.g. T25:00:00Z) that pass the regex
    // and the calendar-day check but produce an Invalid Date.
    if (isNaN(date.getTime())) {
      throw new BadRequestException(
        `Invalid date '${value}'. Expected YYYY-MM-DD or an ISO-8601 timestamp with Z or offset (e.g. 2024-06-15T12:00:00.000Z)`,
      );
    }
    return date;
  }

  // --- AGGREGATES (SQL GROUP BY — never load user rows) --- //

  private async aggregateByDirection(
    walletId: number,
    from: Date,
    to: Date,
    direction: Direction,
  ): Promise<DirectionAgg> {
    const qb = this.baseTxQuery(direction, walletId, from, to);
    qb.select('COALESCE(SUM(tx.amountInChf), 0)', 'volume')
      .addSelect('COUNT(*)', 'transactions')
      .addSelect('COUNT(DISTINCT user.id)', 'users');

    const raw = await this.runQuery(() => qb.getRawOne<AggregateRow>());
    return {
      volume: this.toVolume(raw?.volume),
      transactions: this.toCount(raw?.transactions),
      users: this.toCount(raw?.users),
    };
  }

  /**
   * Distinct active users across buy/sell/swap — COUNT happens in the DB via UNION, not in Node.
   */
  private async countActiveUsers(walletId: number, from: Date, to: Date): Promise<number> {
    const buyQb = this.baseTxQuery(PartnerStatisticDirection.BUY, walletId, from, to).select('user.id', 'id');
    const sellQb = this.baseTxQuery(PartnerStatisticDirection.SELL, walletId, from, to).select('user.id', 'id');
    const swapQb = this.baseTxQuery(PartnerStatisticDirection.SWAP, walletId, from, to).select('user.id', 'id');

    const unionSql = `(${buyQb.getQuery()}) UNION (${sellQb.getQuery()}) UNION (${swapQb.getQuery()})`;

    const raw = await this.runQuery(() =>
      this.buyCryptoRepo.manager
        .createQueryBuilder()
        .from(`(${unionSql})`, 'active_users')
        .select('COUNT(*)', 'count')
        .setParameters({
          ...buyQb.getParameters(),
          ...sellQb.getParameters(),
          ...swapQb.getParameters(),
        })
        .getRawOne<{ count: string | number }>(),
    );

    return this.toCount(raw?.count);
  }

  private async countNewUsers(walletId: number, from: Date, to: Date): Promise<number> {
    return this.runQuery(() =>
      this.userRepo
        .createQueryBuilder('user')
        .where('user.walletId = :walletId', { walletId })
        .andWhere('user.created >= :from AND user.created < :to', { from, to })
        .getCount(),
    );
  }

  private async getAllTime(
    walletId: number,
  ): Promise<{ volume: { buy: number; sell: number; total: number }; registeredUsers: number; tradingUsers: number }> {
    const raw = await this.runQuery(() =>
      this.userRepo
        .createQueryBuilder('user')
        .select('COALESCE(SUM(user.buyVolume), 0)', 'buy')
        .addSelect('COALESCE(SUM(user.sellVolume), 0)', 'sell')
        .addSelect('COUNT(*)', 'registeredUsers')
        .addSelect(
          'COALESCE(SUM(CASE WHEN user.buyVolume > 0 OR user.sellVolume > 0 THEN 1 ELSE 0 END), 0)',
          'tradingUsers',
        )
        .where('user.walletId = :walletId', { walletId })
        .getRawOne<{ buy: string; sell: string; registeredUsers: string; tradingUsers: string }>(),
    );

    const buy = this.toVolume(raw?.buy);
    const sell = this.toVolume(raw?.sell);

    return {
      volume: {
        buy,
        sell,
        total: Util.round(buy + sell, Config.defaultVolumeDecimal),
      },
      registeredUsers: this.toCount(raw?.registeredUsers),
      tradingUsers: this.toCount(raw?.tradingUsers),
    };
  }

  /**
   * Reads the wallet **owner** account (all wallets of that owner), not only the querying wallet.
   * Open credit formula matches user.service / ref-reward.service:
   * refCredit + partnerRefCredit − paidRefCredit.
   *
   * A missing wallet row is a system fault (walletId comes from a valid JWT), not a zero balance.
   */
  private async getReferralRaw(walletId: number): Promise<{
    volume: number;
    creditEarned: number;
    creditPaid: number;
    creditOpen: number;
  }> {
    const raw = await this.runQuery(() =>
      this.walletRepo
        .createQueryBuilder('wallet')
        .leftJoin('wallet.owner', 'owner')
        .select('COALESCE(owner.partnerRefVolume, 0)', 'volume')
        .addSelect('COALESCE(owner.partnerRefCredit, 0)', 'partnerRefCredit')
        .addSelect('COALESCE(owner.refCredit, 0)', 'refCredit')
        .addSelect('COALESCE(owner.paidRefCredit, 0)', 'paidRefCredit')
        .where('wallet.id = :walletId', { walletId })
        .getRawOne<{ volume: string; partnerRefCredit: string; refCredit: string; paidRefCredit: string }>(),
    );

    if (raw == null) {
      throw new Error(`Partner statistic: wallet ${walletId} not found`);
    }

    const volume = this.toVolume(raw.volume);
    const partnerRefCredit = this.toVolume(raw.partnerRefCredit);
    const refCredit = this.toVolume(raw.refCredit);
    const paidRefCredit = this.toVolume(raw.paidRefCredit);

    return {
      volume,
      creditEarned: partnerRefCredit,
      creditPaid: paidRefCredit,
      creditOpen: Util.round(refCredit + partnerRefCredit - paidRefCredit, Config.defaultVolumeDecimal),
    };
  }

  private applyReferralSuppression(
    raw: { volume: number; creditEarned: number; creditPaid: number; creditOpen: number },
    tradingUsers: number,
  ): PartnerReferralDto {
    // Referral balances move with individual customer trades. Gate them on tradingUsers so two
    // successive polls cannot recover a single trade’s credit delta when the cohort is under k.
    // These are the partner’s own account figures (owner-scoped), but the leakage path is the same.
    // suppressScalar is null only for 1..k-1, so a separate `> 0` check is redundant.
    if (suppressScalar(tradingUsers) === null) {
      return {
        volume: null,
        creditEarned: null,
        creditPaid: null,
        creditOpen: null,
        currency: 'EUR',
      };
    }
    return { ...raw, currency: 'EUR' };
  }

  private async aggregateAssets(
    walletId: number,
    from: Date,
    to: Date,
  ): Promise<(PartnerAssetBreakdownDto & { users: number })[]> {
    const [buy, sell, swap] = await this.runAll([
      () => this.assetQuery(PartnerStatisticDirection.BUY, walletId, from, to),
      () => this.assetQuery(PartnerStatisticDirection.SELL, walletId, from, to),
      () => this.assetQuery(PartnerStatisticDirection.SWAP, walletId, from, to),
    ]);

    return [...buy, ...sell, ...swap].sort((a, b) => b.volume - a.volume);
  }

  private async assetQuery(
    direction: Direction,
    walletId: number,
    from: Date,
    to: Date,
  ): Promise<(PartnerAssetBreakdownDto & { users: number })[]> {
    const qb = this.baseTxQuery(direction, walletId, from, to);

    if (direction === PartnerStatisticDirection.SELL) {
      // GROUP BY must use qualified columns — never SELECT aliases (Postgres resolves aliases as input columns).
      qb.leftJoin('tx.cryptoInput', 'cryptoInput')
        .leftJoin('cryptoInput.asset', 'inputAsset')
        .select('tx.inputAsset', 'name')
        .addSelect('inputAsset.blockchain', 'blockchain')
        .addSelect('COALESCE(SUM(tx.amountInChf), 0)', 'volume')
        .addSelect('COUNT(*)', 'transactions')
        .addSelect('COUNT(DISTINCT user.id)', 'users')
        .groupBy('tx.inputAsset')
        .addGroupBy('inputAsset.blockchain');
    } else {
      qb.leftJoin('tx.outputAsset', 'outputAsset')
        .select('outputAsset.name', 'name')
        .addSelect('outputAsset.blockchain', 'blockchain')
        .addSelect('COALESCE(SUM(tx.amountInChf), 0)', 'volume')
        .addSelect('COUNT(*)', 'transactions')
        .addSelect('COUNT(DISTINCT user.id)', 'users')
        .groupBy('outputAsset.name')
        .addGroupBy('outputAsset.blockchain');
    }

    const rows = await this.runQuery(() => qb.getRawMany<NamedAggregateRow>());
    return rows
      .filter((r) => r.name)
      .map((r) => ({
        name: r.name as string,
        blockchain: r.blockchain ?? null,
        direction,
        volume: this.toVolume(r.volume),
        transactions: this.toCount(r.transactions),
        users: this.toCount(r.users),
      }));
  }

  private async aggregateFiatCurrencies(
    walletId: number,
    from: Date,
    to: Date,
  ): Promise<(PartnerNamedBreakdownDto & { users: number })[]> {
    // Buy: inputAsset is the fiat ticker. Sell: outputAsset is Fiat. Swap has no fiat leg.
    const buyQb = this.baseTxQuery(PartnerStatisticDirection.BUY, walletId, from, to)
      .select('tx.inputAsset', 'name')
      .addSelect('COALESCE(SUM(tx.amountInChf), 0)', 'volume')
      .addSelect('COUNT(*)', 'transactions')
      .addSelect('COUNT(DISTINCT user.id)', 'users')
      .groupBy('tx.inputAsset');

    const sellQb = this.baseTxQuery(PartnerStatisticDirection.SELL, walletId, from, to)
      .leftJoin('tx.outputAsset', 'fiat')
      .select('fiat.name', 'name')
      .addSelect('COALESCE(SUM(tx.amountInChf), 0)', 'volume')
      .addSelect('COUNT(*)', 'transactions')
      .addSelect('COUNT(DISTINCT user.id)', 'users')
      .groupBy('fiat.name');

    const [buyRows, sellRows] = await this.runAll([
      () => this.runQuery(() => buyQb.getRawMany<NamedAggregateRow>()),
      () => this.runQuery(() => sellQb.getRawMany<NamedAggregateRow>()),
    ]);

    return this.mergeNamedRows([...buyRows, ...sellRows]);
  }

  private async aggregateBlockchains(
    walletId: number,
    from: Date,
    to: Date,
  ): Promise<(PartnerNamedBreakdownDto & { users: number })[]> {
    const queries = ([PartnerStatisticDirection.BUY, PartnerStatisticDirection.SWAP] as Direction[]).map(
      (direction) => () =>
        this.runQuery(() =>
          this.baseTxQuery(direction, walletId, from, to)
            .leftJoin('tx.outputAsset', 'outputAsset')
            .select('outputAsset.blockchain', 'name')
            .addSelect('COALESCE(SUM(tx.amountInChf), 0)', 'volume')
            .addSelect('COUNT(*)', 'transactions')
            .addSelect('COUNT(DISTINCT user.id)', 'users')
            .groupBy('outputAsset.blockchain')
            .getRawMany<NamedAggregateRow>(),
        ),
    );

    const sellQ = () =>
      this.runQuery(() =>
        this.baseTxQuery(PartnerStatisticDirection.SELL, walletId, from, to)
          .leftJoin('tx.cryptoInput', 'cryptoInput')
          .leftJoin('cryptoInput.asset', 'inputAsset')
          .select('inputAsset.blockchain', 'name')
          .addSelect('COALESCE(SUM(tx.amountInChf), 0)', 'volume')
          .addSelect('COUNT(*)', 'transactions')
          .addSelect('COUNT(DISTINCT user.id)', 'users')
          .groupBy('inputAsset.blockchain')
          .getRawMany<NamedAggregateRow>(),
      );

    const rows = (await this.runAll([...queries, sellQ])).flat();
    return this.mergeNamedRows(rows);
  }

  private async aggregatePaymentMethods(
    walletId: number,
    from: Date,
    to: Date,
  ): Promise<(PartnerNamedBreakdownDto & { users: number })[]> {
    const rows = (
      await this.runAll(
        (
          [PartnerStatisticDirection.BUY, PartnerStatisticDirection.SELL, PartnerStatisticDirection.SWAP] as Direction[]
        ).map(
          (direction) => () =>
            this.runQuery(() =>
              this.baseTxQuery(direction, walletId, from, to)
                .innerJoin('tx.transaction', 'transaction')
                .select('transaction.sourceType', 'name')
                .addSelect('COALESCE(SUM(tx.amountInChf), 0)', 'volume')
                .addSelect('COUNT(*)', 'transactions')
                .addSelect('COUNT(DISTINCT user.id)', 'users')
                .groupBy('transaction.sourceType')
                .getRawMany<NamedAggregateRow>(),
            ),
        ),
      )
    ).flat();

    const mapped = rows.map((r) => ({
      ...r,
      name: PartnerPaymentMethodMap[r.name as TransactionSourceType] ?? r.name,
    }));

    return this.mergeNamedRows(mapped);
  }

  private async timelineByDirection(
    walletId: number,
    from: Date,
    to: Date,
    direction: Direction,
    granularity: PartnerStatisticGranularity,
  ): Promise<Map<string, { volume: number; transactions: number; users: number }>> {
    // Truncate on the stored wall clock (UTC values in TIMESTAMP without TZ), then tag the
    // result as UTC so the driver returns an unambiguous absolute instant. Session TimeZone
    // must not shift buckets — DATE_TRUNC on timestamp without tz is field-only; AT TIME ZONE
    // 'UTC' only re-labels the truncated value as timestamptz.
    const unit = PartnerStatisticDateTruncUnit[granularity];
    const trunc = `DATE_TRUNC('${unit}', tx.created) AT TIME ZONE 'UTC'`;
    const qb = this.baseTxQuery(direction, walletId, from, to)
      .select(trunc, 'bucket')
      .addSelect('COALESCE(SUM(tx.amountInChf), 0)', 'volume')
      .addSelect('COUNT(*)', 'transactions')
      .addSelect('COUNT(DISTINCT user.id)', 'users')
      .groupBy(trunc)
      .orderBy(trunc, 'ASC');

    const rows = await this.runQuery(() => qb.getRawMany<TimelineRawRow>());
    const map = new Map<string, { volume: number; transactions: number; users: number }>();
    for (const row of rows) {
      // UTC keys on both sides (SQL buckets + fill loop). Period bounds are UTC-normalized in
      // resolvePeriod; this module deliberately does not follow support-issue.service local
      // date-parts — that path has no UTC period snap.
      const key = this.bucketKey(this.startOfBucket(new Date(row.bucket), granularity));
      const volume = this.toVolume(row.volume);
      const transactions = this.toCount(row.transactions);
      const users = this.toCount(row.users);
      const existing = map.get(key);
      if (existing) {
        existing.volume = Util.round(existing.volume + volume, Config.defaultVolumeDecimal);
        existing.transactions += transactions;
        // users can double-count on key collision; take max as a lower-bound person estimate
        existing.users = Math.max(existing.users, users);
      } else {
        map.set(key, { volume, transactions, users });
      }
    }
    return map;
  }

  private fillTimelineGaps(
    from: Date,
    to: Date,
    granularity: PartnerStatisticGranularity,
    buy: Map<string, { volume: number; transactions: number; users: number }>,
    sell: Map<string, { volume: number; transactions: number; users: number }>,
    swap: Map<string, { volume: number; transactions: number; users: number }>,
  ): (PartnerTimelineBucketDto & { users: { buy: number; sell: number; swap: number } })[] {
    const buckets: (PartnerTimelineBucketDto & { users: { buy: number; sell: number; swap: number } })[] = [];
    let cursor = this.startOfBucket(from, granularity);
    // `to` is exclusive (half-open period).
    const end = to.getTime();

    while (cursor.getTime() < end) {
      const key = this.bucketKey(cursor);
      const b = buy.get(key) ?? { volume: 0, transactions: 0, users: 0 };
      const s = sell.get(key) ?? { volume: 0, transactions: 0, users: 0 };
      const w = swap.get(key) ?? { volume: 0, transactions: 0, users: 0 };
      const next = this.addBucket(cursor, granularity);
      // Edge buckets whose natural range extends outside [from, to) are partial.
      const partial = cursor.getTime() < from.getTime() || next.getTime() > to.getTime();

      buckets.push({
        date: new Date(cursor),
        volume: { buy: b.volume, sell: s.volume, swap: w.volume },
        transactions: { buy: b.transactions, sell: s.transactions, swap: w.transactions },
        users: { buy: b.users, sell: s.users, swap: w.users },
        suppressed: false,
        partial,
      });

      cursor = next;
    }

    return buckets;
  }

  // --- QUERY BUILDERS --- //

  /**
   * Base query for partner transactions of one direction.
   * Scope is always `user.walletId = :walletId` — never accept walletId from the client.
   * Always filters amlCheck=Pass (volume/totals/breakdown/timeline).
   * Period is half-open: created >= from AND created < to.
   *
   * SQL-side wallet scope on purpose. Repo alternative loads users then IDs
   * (kyc-client.service.ts:37–41 → transaction.service.ts:269 + doInBatchesWithLimit 100);
   * for aggregates that means ~1.270 batches × 18 queries ≈ 22.8k roundtrips on Cake
   * (~127k users) plus full user load — SQL scoping needs 18 queries, no user rows.
   */
  private baseTxQuery(
    direction: Direction,
    walletId: number,
    from: Date,
    to: Date,
  ): SelectQueryBuilder<BuyCrypto | BuyFiat> {
    // Fail-closed: only amlCheck=Pass rows are counted. Omitting the filter would inflate
    // figures with rejected traffic.
    let qb: SelectQueryBuilder<BuyCrypto | BuyFiat>;

    if (direction === PartnerStatisticDirection.SELL) {
      qb = this.buyFiatRepo
        .createQueryBuilder('tx')
        .innerJoin('tx.sell', 'route')
        .innerJoin('route.user', 'user')
        .where('user.walletId = :walletId', { walletId })
        .andWhere('tx.created >= :from AND tx.created < :to', { from, to });
    } else if (direction === PartnerStatisticDirection.BUY) {
      qb = this.buyCryptoRepo
        .createQueryBuilder('tx')
        .innerJoin('tx.buy', 'route')
        .innerJoin('route.user', 'user')
        .where('user.walletId = :walletId', { walletId })
        .andWhere('tx.created >= :from AND tx.created < :to', { from, to });
    } else {
      qb = this.buyCryptoRepo
        .createQueryBuilder('tx')
        .innerJoin('tx.cryptoRoute', 'route')
        .innerJoin('route.user', 'user')
        .where('user.walletId = :walletId', { walletId })
        .andWhere('tx.created >= :from AND tx.created < :to', { from, to });
    }

    qb.andWhere('tx.amlCheck = :check', { check: CheckStatus.PASS });

    return qb;
  }

  // --- HELPERS --- //

  /**
   * Runs every actual SQL execution through the request-scoped gate so nested fan-outs
   * (assets/fiat/blockchains/payment methods) share the same concurrency budget of
   * {@link PARTNER_STATISTIC_QUERY_CONCURRENCY}. Without a shared gate, each nested
   * `runAll` would open its own pool of workers and a single request could exceed the
   * TypeORM connection pool.
   */
  private async runQuery<T>(fn: () => Promise<T>): Promise<T> {
    const gate = PartnerStatisticService.queryGateAls.getStore();
    // No ALS store outside a request (unit/integration tests, direct private-method calls) —
    // safe: those paths have no concurrent fan-out and do not share a TypeORM pool budget.
    if (!gate) return fn();
    return gate.run(fn);
  }

  private async withQueryGate<T>(fn: () => Promise<T>): Promise<T> {
    const existing = PartnerStatisticService.queryGateAls.getStore();
    if (existing) return fn();
    const gate = new QueryConcurrencyGate(PARTNER_STATISTIC_QUERY_CONCURRENCY);
    return PartnerStatisticService.queryGateAls.run(gate, fn);
  }

  /** Fan-out helper: schedule all tasks; concurrency is enforced inside {@link runQuery}. */
  private async runAll<T extends readonly (() => Promise<unknown>)[]>(
    tasks: [...T],
  ): Promise<{ [K in keyof T]: T[K] extends () => Promise<infer R> ? R : never }> {
    const results = await Promise.all(tasks.map((t) => t()));
    return results as { [K in keyof T]: T[K] extends () => Promise<infer R> ? R : never };
  }

  /** Exposed for tests that exercise mergeNamedRows / breakdown mapping without full SQL. */
  mergeNamedRows(rows: NamedAggregateRow[]): (PartnerNamedBreakdownDto & { users: number })[] {
    const map = new Map<string, PartnerNamedBreakdownDto & { users: number }>();

    for (const row of rows) {
      if (!row.name) continue;
      const existing = map.get(row.name);
      const volume = this.toVolume(row.volume);
      const transactions = this.toCount(row.transactions);
      const users = this.toCount(row.users);
      if (existing) {
        existing.volume = Util.round(existing.volume + volume, Config.defaultVolumeDecimal);
        existing.transactions += transactions;
        // Person floor across partial GROUP BY chunks: max, never min (min under-counts).
        existing.users = Math.max(existing.users, users);
      } else {
        map.set(row.name, { name: row.name, volume, transactions, users });
      }
    }

    return [...map.values()].sort((a, b) => b.volume - a.volume);
  }

  /**
   * Coerce a SQL aggregate cell to a finite number.
   * COUNT(*)/COALESCE(SUM(...), 0) return 0 over an empty match set (a row is still returned).
   * Non-numeric driver values must not become JSON `null` (which this API uses for suppression).
   */
  private toVolume(value: string | number | null | undefined): number {
    const n = +(value ?? 0);
    if (Number.isNaN(n)) {
      throw new Error(`Partner statistic: non-numeric volume aggregate (${String(value)})`);
    }
    return Util.round(n, Config.defaultVolumeDecimal);
  }

  /** Same as toVolume for integer counts. */
  private toCount(value: string | number | null | undefined): number {
    const n = +(value ?? 0);
    if (Number.isNaN(n)) {
      throw new Error(`Partner statistic: non-numeric count aggregate (${String(value)})`);
    }
    return Math.trunc(n);
  }

  /**
   * Stable date-part key for timeline bucket maps. Uses UTC getters to match the
   * UTC-normalized bucket starts from {@link startOfBucket} and SQL `DATE_TRUNC` /
   * `AT TIME ZONE 'UTC'`. The fill path builds the same keys, so SQL rows and empty
   * fillers collide correctly; any consistent timezone would work as long as both
   * sides match (bucket starts are ≥ 24 h apart, so local-vs-UTC day shifts do not
   * collide distinct buckets under this spacing).
   */
  private bucketKey(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  }

  private startOfBucket(date: Date, granularity: PartnerStatisticGranularity): Date {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);

    if (granularity === PartnerStatisticGranularity.MONTH) {
      d.setUTCDate(1);
    } else if (granularity === PartnerStatisticGranularity.WEEK) {
      // Align to Monday UTC (Postgres DATE_TRUNC('week') is ISO week starting Monday).
      const day = d.getUTCDay(); // 0=Sun … 6=Sat
      const diff = day === 0 ? 6 : day - 1;
      d.setUTCDate(d.getUTCDate() - diff);
    }

    return d;
  }

  private addBucket(date: Date, granularity: PartnerStatisticGranularity): Date {
    const d = new Date(date);
    if (granularity === PartnerStatisticGranularity.DAY) d.setUTCDate(d.getUTCDate() + 1);
    else if (granularity === PartnerStatisticGranularity.WEEK) d.setUTCDate(d.getUTCDate() + 7);
    else d.setUTCMonth(d.getUTCMonth() + 1);
    return d;
  }

  private startOfUtcDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  private addUtcDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }
}
