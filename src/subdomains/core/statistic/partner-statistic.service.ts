import { BadRequestException, Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { BuyCryptoRepository } from 'src/subdomains/core/buy-crypto/process/repositories/buy-crypto.repository';
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import { UserRepository } from 'src/subdomains/generic/user/models/user/user.repository';
import { WalletRepository } from 'src/subdomains/generic/user/models/wallet/wallet.repository';
import {
  TransactionRequestStatus,
  TransactionRequestType,
} from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { TransactionSourceType } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { TransactionRequestRepository } from 'src/subdomains/supporting/payment/repositories/transaction-request.repository';
import { SelectQueryBuilder } from 'typeorm';
import { BuyCrypto } from '../buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from '../sell-crypto/process/buy-fiat.entity';
import {
  PartnerAssetBreakdownDto,
  PartnerCompletionDto,
  PartnerNamedBreakdownDto,
  PartnerPaymentInfoDirectionDto,
  PartnerReferralDto,
  PartnerSettlementDirectionDto,
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
  PartnerStatisticDirection,
  PartnerStatisticGranularity,
} from './partner-statistic.enum';
import {
  suppressAdditiveGroup,
  suppressAllTimeVolume,
  suppressBreakdownRows,
  suppressPeriodTotals,
  suppressScalar,
  suppressTimelineBuckets,
} from './partner-statistic.suppression';

type Direction = PartnerStatisticDirection;

interface BaseTxQueryOptions {
  /** When true (default), only amlCheck=Pass rows. Settlement stage B sets false. */
  amlPassOnly?: boolean;
}

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

@Injectable()
export class PartnerStatisticService {
  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyFiatRepo: BuyFiatRepository,
    private readonly userRepo: UserRepository,
    private readonly walletRepo: WalletRepository,
    private readonly txRequestRepo: TransactionRequestRepository,
  ) {}

  // --- PUBLIC API --- //

  async getStatistics(walletId: number, from?: string | Date, to?: string | Date): Promise<PartnerStatisticDto> {
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
      completionResult,
    ] = await this.runLimited([
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
      () => this.getCompletion(walletId, period.from, period.to),
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

    const suppressedBuckets =
      assets.suppressedCount +
      fiatCurrencies.suppressedCount +
      blockchains.suppressedCount +
      paymentMethods.suppressedCount +
      totalsSuppressed.suppressedCount +
      allTimeSuppressed.suppressedCount +
      completionResult.suppressedCount +
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
      completion: completionResult.completion,
      meta: {
        suppressionThreshold: PARTNER_STATISTIC_SUPPRESSION_THRESHOLD,
        suppressedBuckets,
        generatedAt: new Date(),
      },
    };
  }

  async getTimeline(
    walletId: number,
    from?: string | Date,
    to?: string | Date,
    granularity: string = PartnerStatisticGranularity.DAY,
  ): Promise<PartnerTimelineDto> {
    const resolvedGranularity = this.parseGranularity(granularity);
    const period = this.resolvePeriod(from, to);

    const [buyRows, sellRows, swapRows] = await this.runLimited([
      () =>
        this.timelineByDirection(walletId, period.from, period.to, PartnerStatisticDirection.BUY, resolvedGranularity),
      () =>
        this.timelineByDirection(walletId, period.from, period.to, PartnerStatisticDirection.SELL, resolvedGranularity),
      () =>
        this.timelineByDirection(walletId, period.from, period.to, PartnerStatisticDirection.SWAP, resolvedGranularity),
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
        suppressedBuckets: suppressedCount,
      },
    };
  }

  // --- PERIOD / VALIDATION --- //

  /**
   * Snaps `from`/`to` to UTC day boundaries (half-open [from, to)), enforces min 1 day and max span.
   * Accepts ISO strings or Date; parsing lives here so the controller stays free of date logic.
   */
  resolvePeriod(from?: string | Date, to?: string | Date): { from: Date; to: Date } {
    const resolvedTo = this.parseDate(to) ?? new Date();
    const resolvedFrom = this.parseDate(from) ?? Util.daysBefore(PARTNER_STATISTIC_DEFAULT_PERIOD_DAYS, resolvedTo);

    if (isNaN(resolvedFrom.getTime()) || isNaN(resolvedTo.getTime())) {
      throw new BadRequestException('Invalid date');
    }

    // Snap: from → start of its UTC day; to → start of the UTC day after the last included day (exclusive).
    const fromDay = this.startOfUtcDay(resolvedFrom);
    const toDayStart = this.startOfUtcDay(resolvedTo);
    const toExclusive = this.addUtcDays(toDayStart, 1);

    if (fromDay.getTime() >= toExclusive.getTime()) {
      throw new BadRequestException('From must be before to');
    }

    const spanDays = (toExclusive.getTime() - fromDay.getTime()) / (24 * 3600 * 1000);
    if (spanDays < 1) {
      throw new BadRequestException('Period must cover at least one full day');
    }
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

  parseDate(value?: string | Date): Date | undefined {
    if (value == null || value === '') return undefined;
    if (value instanceof Date) {
      if (isNaN(value.getTime())) throw new BadRequestException('Invalid date');
      return value;
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) throw new BadRequestException(`Invalid date: ${value}`);
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

    const raw = await qb.getRawOne<AggregateRow>();
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

    const raw = await this.buyCryptoRepo.manager
      .createQueryBuilder()
      .from(`(${unionSql})`, 'active_users')
      .select('COUNT(*)', 'count')
      .setParameters({
        ...buyQb.getParameters(),
        ...sellQb.getParameters(),
        ...swapQb.getParameters(),
      })
      .getRawOne<{ count: string | number }>();

    return this.toCount(raw?.count);
  }

  private async countNewUsers(walletId: number, from: Date, to: Date): Promise<number> {
    return this.userRepo
      .createQueryBuilder('user')
      .where('user.walletId = :walletId', { walletId })
      .andWhere('user.created >= :from AND user.created < :to', { from, to })
      .getCount();
  }

  private async getAllTime(
    walletId: number,
  ): Promise<{ volume: { buy: number; sell: number; total: number }; registeredUsers: number; tradingUsers: number }> {
    const raw = await this.userRepo
      .createQueryBuilder('user')
      .select('COALESCE(SUM(user.buyVolume), 0)', 'buy')
      .addSelect('COALESCE(SUM(user.sellVolume), 0)', 'sell')
      .addSelect('COUNT(*)', 'registeredUsers')
      .addSelect(
        'COALESCE(SUM(CASE WHEN user.buyVolume > 0 OR user.sellVolume > 0 THEN 1 ELSE 0 END), 0)',
        'tradingUsers',
      )
      .where('user.walletId = :walletId', { walletId })
      .getRawOne<{ buy: string; sell: string; registeredUsers: string; tradingUsers: string }>();

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
   */
  private async getReferralRaw(walletId: number): Promise<{
    volume: number;
    creditEarned: number;
    creditPaid: number;
    creditOpen: number;
  }> {
    const raw = await this.walletRepo
      .createQueryBuilder('wallet')
      .leftJoin('wallet.owner', 'owner')
      .select('COALESCE(owner.partnerRefVolume, 0)', 'volume')
      .addSelect('COALESCE(owner.partnerRefCredit, 0)', 'partnerRefCredit')
      .addSelect('COALESCE(owner.refCredit, 0)', 'refCredit')
      .addSelect('COALESCE(owner.paidRefCredit, 0)', 'paidRefCredit')
      .where('wallet.id = :walletId', { walletId })
      .getRawOne<{ volume: string; partnerRefCredit: string; refCredit: string; paidRefCredit: string }>();

    const volume = this.toVolume(raw?.volume);
    const partnerRefCredit = this.toVolume(raw?.partnerRefCredit);
    const refCredit = this.toVolume(raw?.refCredit);
    const paidRefCredit = this.toVolume(raw?.paidRefCredit);

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
    if (suppressScalar(tradingUsers) === null && tradingUsers > 0) {
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
    const [buy, sell, swap] = await this.runLimited([
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

    const rows = await qb.getRawMany<NamedAggregateRow>();
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

    const [buyRows, sellRows] = await this.runLimited([
      () => buyQb.getRawMany<NamedAggregateRow>(),
      () => sellQb.getRawMany<NamedAggregateRow>(),
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
        this.baseTxQuery(direction, walletId, from, to)
          .leftJoin('tx.outputAsset', 'outputAsset')
          .select('outputAsset.blockchain', 'name')
          .addSelect('COALESCE(SUM(tx.amountInChf), 0)', 'volume')
          .addSelect('COUNT(*)', 'transactions')
          .addSelect('COUNT(DISTINCT user.id)', 'users')
          .groupBy('outputAsset.blockchain')
          .getRawMany<NamedAggregateRow>(),
    );

    const sellQ = () =>
      this.baseTxQuery(PartnerStatisticDirection.SELL, walletId, from, to)
        .leftJoin('tx.cryptoInput', 'cryptoInput')
        .leftJoin('cryptoInput.asset', 'inputAsset')
        .select('inputAsset.blockchain', 'name')
        .addSelect('COALESCE(SUM(tx.amountInChf), 0)', 'volume')
        .addSelect('COUNT(*)', 'transactions')
        .addSelect('COUNT(DISTINCT user.id)', 'users')
        .groupBy('inputAsset.blockchain')
        .getRawMany<NamedAggregateRow>();

    const rows = (await this.runLimited([...queries, sellQ])).flat();
    return this.mergeNamedRows(rows);
  }

  private async aggregatePaymentMethods(
    walletId: number,
    from: Date,
    to: Date,
  ): Promise<(PartnerNamedBreakdownDto & { users: number })[]> {
    const rows = (
      await this.runLimited(
        (
          [PartnerStatisticDirection.BUY, PartnerStatisticDirection.SELL, PartnerStatisticDirection.SWAP] as Direction[]
        ).map(
          (direction) => () =>
            this.baseTxQuery(direction, walletId, from, to)
              .innerJoin('tx.transaction', 'transaction')
              .select('transaction.sourceType', 'name')
              .addSelect('COALESCE(SUM(tx.amountInChf), 0)', 'volume')
              .addSelect('COUNT(*)', 'transactions')
              .addSelect('COUNT(DISTINCT user.id)', 'users')
              .groupBy('transaction.sourceType')
              .getRawMany<NamedAggregateRow>(),
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
    const trunc = `DATE_TRUNC('${granularity}', tx.created) AT TIME ZONE 'UTC'`;
    const qb = this.baseTxQuery(direction, walletId, from, to)
      .select(trunc, 'bucket')
      .addSelect('COALESCE(SUM(tx.amountInChf), 0)', 'volume')
      .addSelect('COUNT(*)', 'transactions')
      .addSelect('COUNT(DISTINCT user.id)', 'users')
      .groupBy(trunc)
      .orderBy(trunc, 'ASC');

    const rows = await qb.getRawMany<TimelineRawRow>();
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

  // --- COMPLETION (stage A + B) --- //

  private async getCompletion(
    walletId: number,
    from: Date,
    to: Date,
  ): Promise<{ completion: PartnerCompletionDto; suppressedCount: number }> {
    const [paymentInfoRaw, buySettlement, sellSettlement, swapSettlement] = await this.runLimited([
      () => this.aggregatePaymentInfoRequests(walletId, from, to),
      () => this.aggregateSettlement(walletId, from, to, PartnerStatisticDirection.BUY),
      () => this.aggregateSettlement(walletId, from, to, PartnerStatisticDirection.SELL),
      () => this.aggregateSettlement(walletId, from, to, PartnerStatisticDirection.SWAP),
    ]);

    let suppressedCount = 0;

    const paymentInfoRequests = {
      buy: this.suppressPaymentInfoFunnel(paymentInfoRaw.buy, (n) => {
        suppressedCount += n;
      }),
      sell: this.suppressPaymentInfoFunnel(paymentInfoRaw.sell, (n) => {
        suppressedCount += n;
      }),
      swap: this.suppressPaymentInfoFunnel(paymentInfoRaw.swap, (n) => {
        suppressedCount += n;
      }),
    };

    const settlement = {
      buy: this.suppressSettlementFunnel(buySettlement, (n) => {
        suppressedCount += n;
      }),
      sell: this.suppressSettlementFunnel(sellSettlement, (n) => {
        suppressedCount += n;
      }),
      swap: this.suppressSettlementFunnel(swapSettlement, (n) => {
        suppressedCount += n;
      }),
    };

    return { completion: { paymentInfoRequests, settlement }, suppressedCount };
  }

  private async aggregatePaymentInfoRequests(
    walletId: number,
    from: Date,
    to: Date,
  ): Promise<
    Record<
      Direction,
      { requested: number; paymentReceived: number; waitingForPayment: number; noPaymentReceived: number }
    >
  > {
    const empty = () => ({ requested: 0, paymentReceived: 0, waitingForPayment: 0, noPaymentReceived: 0 });
    const byDir: Record<Direction, ReturnType<typeof empty>> = {
      [PartnerStatisticDirection.BUY]: empty(),
      [PartnerStatisticDirection.SELL]: empty(),
      [PartnerStatisticDirection.SWAP]: empty(),
    };

    const rows = await this.txRequestRepo
      .createQueryBuilder('tr')
      .innerJoin('tr.user', 'user')
      .select('tr.type', 'type')
      .addSelect('tr.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('user.walletId = :walletId', { walletId })
      .andWhere('tr.created >= :from AND tr.created < :to', { from, to })
      .groupBy('tr.type')
      .addGroupBy('tr.status')
      .getRawMany<{ type: string; status: string; count: string | number }>();

    const typeToDir: Record<string, Direction> = {
      [TransactionRequestType.BUY]: PartnerStatisticDirection.BUY,
      [TransactionRequestType.SELL]: PartnerStatisticDirection.SELL,
      [TransactionRequestType.SWAP]: PartnerStatisticDirection.SWAP,
    };

    for (const row of rows) {
      const dir = typeToDir[row.type];
      if (!dir) continue;
      const count = this.toCount(row.count);
      byDir[dir].requested += count;
      if (row.status === TransactionRequestStatus.COMPLETED) byDir[dir].paymentReceived += count;
      else if (row.status === TransactionRequestStatus.WAITING_FOR_PAYMENT) byDir[dir].waitingForPayment += count;
      else if (row.status === TransactionRequestStatus.CREATED) byDir[dir].noPaymentReceived += count;
    }

    return byDir;
  }

  private async aggregateSettlement(
    walletId: number,
    from: Date,
    to: Date,
    direction: Direction,
  ): Promise<{ received: number; delivered: number; rejected: number; inProgress: number }> {
    const pass = CheckStatus.PASS;
    const fail = CheckStatus.FAIL;

    const qb = this.baseTxQuery(direction, walletId, from, to, { amlPassOnly: false });
    qb.select('COUNT(*)', 'received')
      .addSelect(
        `COALESCE(SUM(CASE WHEN tx.amlCheck = :passCheck AND tx.isComplete = true THEN 1 ELSE 0 END), 0)`,
        'delivered',
      )
      .addSelect(`COALESCE(SUM(CASE WHEN tx.amlCheck = :failCheck THEN 1 ELSE 0 END), 0)`, 'rejected')
      .setParameter('passCheck', pass)
      .setParameter('failCheck', fail);

    const raw = await qb.getRawOne<{ received: string; delivered: string; rejected: string }>();
    const received = this.toCount(raw?.received);
    const delivered = this.toCount(raw?.delivered);
    const rejected = this.toCount(raw?.rejected);
    const inProgress = Math.max(received - delivered - rejected, 0);

    return { received, delivered, rejected, inProgress };
  }

  private suppressPaymentInfoFunnel(
    raw: { requested: number; paymentReceived: number; waitingForPayment: number; noPaymentReceived: number },
    onSuppressed: (n: number) => void,
  ): PartnerPaymentInfoDirectionDto {
    const { values, rate, suppressedCount } = suppressAdditiveGroup(
      {
        requested: raw.requested,
        paymentReceived: raw.paymentReceived,
        waitingForPayment: raw.waitingForPayment,
        noPaymentReceived: raw.noPaymentReceived,
      },
      { numeratorKey: 'paymentReceived', denominatorKey: 'requested' },
    );
    onSuppressed(suppressedCount);

    return {
      requested: values.requested,
      paymentReceived: values.paymentReceived,
      waitingForPayment: values.waitingForPayment,
      noPaymentReceived: values.noPaymentReceived,
      receivedRate: rate,
    };
  }

  private suppressSettlementFunnel(
    raw: { received: number; delivered: number; rejected: number; inProgress: number },
    onSuppressed: (n: number) => void,
  ): PartnerSettlementDirectionDto {
    const { values, rate, suppressedCount } = suppressAdditiveGroup(
      {
        received: raw.received,
        delivered: raw.delivered,
        rejected: raw.rejected,
        inProgress: raw.inProgress,
      },
      { numeratorKey: 'delivered', denominatorKey: 'received' },
    );
    onSuppressed(suppressedCount);

    return {
      received: values.received,
      delivered: values.delivered,
      rejected: values.rejected,
      inProgress: values.inProgress,
      deliveredRate: rate,
    };
  }

  // --- QUERY BUILDERS --- //

  /**
   * Base query for partner transactions of one direction.
   * Scope is always `user.walletId = :walletId` — never accept walletId from the client.
   * Default filters amlCheck=Pass (volume/totals/breakdown). Settlement stage B passes amlPassOnly: false.
   * Period is half-open: created >= from AND created < to.
   */
  private baseTxQuery(
    direction: Direction,
    walletId: number,
    from: Date,
    to: Date,
    options: BaseTxQueryOptions = {},
  ): SelectQueryBuilder<BuyCrypto | BuyFiat> {
    // Fail-closed: without an explicit opt-out, only amlCheck=Pass rows are counted. That is the safe
    // direction for volume/totals — omitting the filter would inflate figures with rejected traffic.
    // Settlement stage B is the sole caller that sets amlPassOnly: false (needs Fail / in-progress too).
    const amlPassOnly = options.amlPassOnly ?? true;

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

    if (amlPassOnly) {
      qb.andWhere('tx.amlCheck = :check', { check: CheckStatus.PASS });
    }

    return qb;
  }

  // --- HELPERS --- //

  /**
   * Runs async tasks with a hard cap on concurrency so a single partner request cannot saturate
   * the TypeORM pool (default size 10). Max concurrency: PARTNER_STATISTIC_QUERY_CONCURRENCY (4).
   */
  private async runLimited<T extends readonly (() => Promise<unknown>)[]>(
    tasks: [...T],
    concurrency = PARTNER_STATISTIC_QUERY_CONCURRENCY,
  ): Promise<{ [K in keyof T]: T[K] extends () => Promise<infer R> ? R : never }> {
    const results: unknown[] = new Array(tasks.length);
    let next = 0;

    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        results[i] = await tasks[i]();
      }
    });

    await Promise.all(workers);
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
        existing.users = Math.max(existing.users, users);
      } else {
        map.set(row.name, { name: row.name, volume, transactions, users });
      }
    }

    return [...map.values()].sort((a, b) => b.volume - a.volume);
  }

  /**
   * SQL aggregates always use COALESCE(SUM(...), 0) or COUNT(*), so an empty match set yields 0
   * (a row is still returned). Null/undefined only appears when getRawOne finds no row at all
   * (e.g. missing wallet on a left join) — that is absence of data, which is correctly 0 volume.
   */
  private toVolume(value: string | number | null | undefined): number {
    return Util.round(+(value ?? 0), Config.defaultVolumeDecimal);
  }

  /**
   * Same as toVolume: COUNT(*) is 0 over an empty set; null/undefined means no row, i.e. zero count.
   */
  private toCount(value: string | number | null | undefined): number {
    return Math.trunc(+(value ?? 0));
  }

  /**
   * UTC date-part key — matches resolvePeriod (UTC day snap) and SQL
   * `DATE_TRUNC(...) AT TIME ZONE 'UTC'`. Not process-local: unlike support-issue.service,
   * this timeline is period-normalized to UTC, so keys must be UTC too.
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
