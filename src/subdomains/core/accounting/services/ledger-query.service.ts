import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { LiquidityBalance } from 'src/subdomains/core/liquidity-management/entities/liquidity-balance.entity';
import { LiquidityManagementBalanceService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-balance.service';
import { FinanceLog } from 'src/subdomains/supporting/log/dto/log.dto';
import { LogService } from 'src/subdomains/supporting/log/log.service';
import { In } from 'typeorm';
import {
  EquityComparisonDto,
  EquityComparisonPeriodDto,
  EquityDecompositionDto,
  MarginPeriodDto,
  MarginResponseDto,
} from '../dto/ledger-margin.dto';
import {
  LedgerAccountBalanceDto,
  LedgerAccountsResponseDto,
  LedgerLegEntryDto,
  LedgerLegsResponseDto,
  LedgerReconStatus,
} from '../dto/ledger-account.dto';
import {
  AccountBalance,
  AccountReconResult,
  AccountReconSnapshot,
  LedgerDtoMapper,
  SuspenseLegRow,
} from '../dto/ledger-dto.mapper';
import {
  AccountReconResultDto,
  LedgerFeedStaleness,
  LedgerReconResultStatus,
  ReconStatusResponseDto,
  SuspenseResponseDto,
} from '../dto/ledger-reconciliation.dto';
import { AccountType, LedgerAccount } from '../entities/ledger-account.entity';
import { LedgerLeg } from '../entities/ledger-leg.entity';
import { LedgerAccountRepository } from '../repositories/ledger-account.repository';
import { LedgerLegRepository } from '../repositories/ledger-leg.repository';
import { LedgerMarkCache, LedgerMarkService } from './ledger-mark.service';
import { FeedStatus, LedgerReconciliationService } from './ledger-reconciliation.service';

const LEGS_PAGE_SIZE = 100;
const MARK_TO_MARKET_SOURCE = 'mark_to_market';

// §7.6 (perf): server-side cap on the equity-comparison range. `from` is mandatory (rejects a full-history scan) and
// the window [from, now] must stay within this many days so the endpoint's cost is bounded (~1 quarter of daily logs).
const MAX_EQUITY_COMPARISON_RANGE_DAYS = 92;

// running cumulative of the four equity-comparison components at a given UTC day (YYYY-MM-DD), §7.6
interface EquityDayAgg {
  day: string;
  equity: number; // Σ amountChf over the balance-account types
  transit: number; // Σ amountChf on TRANSIT accounts (Class-2 phantom)
  stale: number; // Σ amountChf of mark_to_market legs on currently-unverified accounts (Class-3)
  spread: number; // Σ amountChf on EXPENSE accounts excl. refReward/extraordinary/fx-revaluation (Class-6)
}

/**
 * Read-only query layer for the ADMIN ledger endpoints (§8). Pure observer: it only reads from ledger_* plus the
 * whitelisted feed read (LiquidityManagementBalanceService.getBalances, §7.0/§4.10), the persisted mark read
 * (LedgerMarkService.preload, §5.2 — to value the native journal↔feed diff in CHF, §7) and the read-only LogService
 * (FinancialDataLog time-series for the equity comparison). It reuses LedgerReconciliationService.classifyFeed for
 * the staleness classification so the API view matches the daily reconciliation run. No pricing-service injection,
 * no external calls, no writes.
 */
@Injectable()
export class LedgerQueryService {
  constructor(
    private readonly ledgerAccountRepository: LedgerAccountRepository,
    private readonly ledgerLegRepository: LedgerLegRepository,
    private readonly reconciliationService: LedgerReconciliationService,
    private readonly liquidityManagementBalanceService: LiquidityManagementBalanceService,
    private readonly markService: LedgerMarkService,
    private readonly logService: LogService,
  ) {}

  // --- GET ledger/accounts (balance list) --- //

  async getAccounts(from?: Date, to?: Date): Promise<LedgerAccountsResponseDto> {
    const now = new Date();
    const period = this.resolvePeriod(from, to, now);

    // ASSET-account recon snapshot for the list (against the persisted feed, §7) — feed read once for all accounts.
    // §7 (unit fix): marks read ONCE per request (same 2-day window as the reconciliation job) to value the native
    // journal↔feed diff in CHF before the CHF-tolerance check (see mapReconStatus)
    const [accounts, balances, feedByAssetId, marks] = await Promise.all([
      this.ledgerAccountRepository.find({ relations: { asset: { bank: true } } }),
      this.balancesByAccount(period.to),
      this.feedByAssetId(),
      this.markService.preload(Util.daysBefore(2, now), now),
    ]);

    const accountDtos: LedgerAccountBalanceDto[] = accounts.map((account) => {
      const balance: AccountBalance = {
        account,
        balanceNative: balances.get(account.id)?.native ?? 0,
        balanceChf: balances.get(account.id)?.chf ?? 0,
      };
      const recon = this.reconSnapshot(account, balance.balanceNative, feedByAssetId, marks, now);
      return LedgerDtoMapper.mapAccountBalance(balance, recon);
    });

    return { period: LedgerDtoMapper.mapPeriod(period.from, period.to), accounts: accountDtos };
  }

  // --- GET ledger/accounts/:accountId/legs (T-account legs, paginated §8) --- //

  async getAccountDetail(accountId: number, from?: Date, to?: Date, page = 0): Promise<LedgerLegsResponseDto> {
    const now = new Date();
    const period = this.resolvePeriod(from, to, now);

    const account = await this.ledgerAccountRepository.findOneBy({ id: accountId });
    if (!account) throw new NotFoundException('Ledger account not found');

    // opening balance = signed native Σ of all legs booked strictly before the period start
    const [openingBalance, periodNative] = await Promise.all([
      this.nativeBalanceBefore(accountId, period.from),
      this.nativeBalanceInPeriod(accountId, period.from, period.to),
    ]);
    const closingBalance = Util.round(openingBalance + periodNative, 8);

    const [legs, total] = await this.ledgerLegRepository
      .createQueryBuilder('leg')
      .innerJoinAndSelect('leg.tx', 'tx')
      .where('leg.accountId = :accountId', { accountId })
      .andWhere('tx.bookingDate >= :from', { from: period.from })
      .andWhere('tx.bookingDate <= :to', { to: period.to })
      .orderBy('tx.bookingDate', 'DESC')
      .addOrderBy('leg.id', 'DESC')
      .skip(page * LEGS_PAGE_SIZE)
      .take(LEGS_PAGE_SIZE)
      .getManyAndCount();

    const legDtos = await this.mapLegsWithCounterAccount(legs, accountId);

    return {
      accountId: account.id,
      accountName: account.name,
      currency: account.currency,
      period: LedgerDtoMapper.mapPeriod(period.from, period.to),
      openingBalance,
      closingBalance,
      legs: legDtos,
      total,
    };
  }

  // --- GET ledger/reconciliation (recon status) --- //

  async getReconStatus(): Promise<ReconStatusResponseDto> {
    const now = new Date();

    // §7 (unit fix): marks read ONCE per request (same 2-day window as the reconciliation job) — see mapReconStatus
    const [accounts, feedByAssetId, balances, marks] = await Promise.all([
      this.ledgerAccountRepository.find({
        where: { type: AccountType.ASSET, active: true },
        relations: { asset: { bank: true } },
      }),
      this.feedByAssetId(),
      this.nativeBalanceByAccount(),
      this.markService.preload(Util.daysBefore(2, now), now),
    ]);

    const results: AccountReconResultDto[] = [];
    for (const account of accounts) {
      if (account.assetId == null) continue;

      const ledgerBalance = balances.get(account.id) ?? 0;
      const result = this.reconResult(account, ledgerBalance, feedByAssetId, marks, now);
      results.push(LedgerDtoMapper.mapReconResult(result));
    }

    return { runAt: now.toISOString(), accounts: results };
  }

  // --- GET ledger/suspense --- //

  async getSuspense(): Promise<SuspenseResponseDto> {
    const now = new Date();

    const legs = await this.ledgerLegRepository
      .createQueryBuilder('leg')
      .innerJoinAndSelect('leg.tx', 'tx')
      .innerJoinAndSelect('leg.account', 'account')
      .where('account.type = :type', { type: AccountType.SUSPENSE })
      .orderBy('tx.bookingDate', 'ASC')
      .getMany();

    const rows: SuspenseLegRow[] = legs.map((leg) => ({
      leg,
      bookingDate: leg.tx.bookingDate,
      age: Util.daysDiff(leg.tx.bookingDate, now),
    }));

    const totalChf = Util.round(Util.sum(legs.map((l) => l.amountChf ?? 0)), 2);

    return { totalChf, legs: rows.map((row) => LedgerDtoMapper.mapSuspenseLeg(row)) };
  }

  // --- GET ledger/margin (realized-margin report §1.11/§7.6) --- //

  async getMargin(from?: Date, to?: Date, dailySample = true): Promise<MarginResponseDto> {
    const now = new Date();
    const period = this.resolvePeriod(from, to, now);

    const buckets = await this.marginBuckets(period.from, period.to, dailySample);

    const periods: MarginPeriodDto[] = buckets.map((b) => ({
      date: b.date,
      feeIncome: b.feeIncome,
      executionCosts: b.executionCosts,
      otherOpex: b.otherOpex,
      realizedMargin: Util.round(b.feeIncome - b.executionCosts, 2),
      fxPnl: b.fxPnl,
    }));

    return {
      periods,
      totalFeeIncome: Util.round(Util.sumObjValue(periods, 'feeIncome'), 2),
      totalExecutionCosts: Util.round(Util.sumObjValue(periods, 'executionCosts'), 2),
      totalOtherOpex: Util.round(Util.sumObjValue(periods, 'otherOpex'), 2),
      totalRealizedMargin: Util.round(Util.sumObjValue(periods, 'realizedMargin'), 2),
    };
  }

  // --- GET ledger/equity-comparison (§7.6) --- //

  async getEquityComparison(from?: Date, dailySample = true): Promise<EquityComparisonDto> {
    const now = new Date();

    // §7.6 (perf a): `from` is mandatory and the range is capped — the old code scanned the ENTIRE ledger history per
    // log period when `from` was omitted. Fail loud (BadRequest) rather than silently run an unbounded full scan.
    if (from == null) throw new BadRequestException('from is required');
    if (Util.daysDiff(from, now) > MAX_EQUITY_COMPARISON_RANGE_DAYS)
      throw new BadRequestException(`Range from-now must not exceed ${MAX_EQUITY_COMPARISON_RANGE_DAYS} days`);

    const logs = await this.logService.getFinancialLogs(from, dailySample);
    if (!logs.length) return { periods: [] };

    // §7.6 (perf b): the unverified-account set (incl. the feed read) is period-independent → compute it ONCE for the
    // whole comparison instead of re-reading the entire feed inside every log iteration (was N feed reads).
    const unverifiedAccountIds = await this.unverifiedAccountIds();

    // §7.6 (perf c): all four per-period aggregates come from ONE day-grouped ledger_leg pass, turned into running
    // cumulative totals in memory — instead of four cumulative SUM queries per log period (was O(periods) full scans).
    const lastPeriod = logs[logs.length - 1].created;
    const cumulative = await this.cumulativeEquityByDay(lastPeriod, unverifiedAccountIds);

    const periods: EquityComparisonPeriodDto[] = [];
    for (const log of logs) {
      const finance = this.parseFinance(log.message);
      const financialDataLogTotal = finance?.balancesTotal?.totalBalanceChf;
      if (financialDataLogTotal == null) continue;

      const at = this.cumulativeAt(cumulative, log.created);
      const journalEquity = Util.round(at.equity, 2);
      const difference = Util.round(journalEquity - financialDataLogTotal, 2);
      const decomposition: EquityDecompositionDto = {
        transitPhantom: Util.round(at.transit, 2),
        staleFeed: Util.round(at.stale, 2),
        spreadFees: Util.round(at.spread, 2),
        other: Util.round(difference - (at.transit + at.stale + at.spread), 2),
      };

      periods.push({
        date: log.created.toISOString(),
        journalEquity,
        financialDataLogTotal,
        difference,
        decomposition,
      });
    }

    return { periods };
  }

  // --- BALANCE AGGREGATION HELPERS --- //

  // signed native + chf balance per account up to `to` (closing balance over all legs booked ≤ to)
  private async balancesByAccount(to: Date): Promise<Map<number, { native: number; chf: number }>> {
    const raw = await this.ledgerLegRepository
      .createQueryBuilder('leg')
      .innerJoin('leg.tx', 'tx')
      .select('leg.accountId', 'accountId')
      .addSelect('SUM(leg.amount)', 'native')
      .addSelect('SUM(COALESCE(leg.amountChf, 0))', 'chf')
      .where('tx.bookingDate <= :to', { to })
      .groupBy('leg.accountId')
      .getRawMany<{ accountId: number; native: string; chf: string }>();

    return new Map(raw.map((r) => [+r.accountId, { native: Util.round(+r.native, 8), chf: Util.round(+r.chf, 2) }]));
  }

  private async nativeBalanceBefore(accountId: number, from: Date): Promise<number> {
    const raw = await this.ledgerLegRepository
      .createQueryBuilder('leg')
      .innerJoin('leg.tx', 'tx')
      .select('SUM(leg.amount)', 'native')
      .where('leg.accountId = :accountId', { accountId })
      .andWhere('tx.bookingDate < :from', { from })
      .getRawOne<{ native: string | null }>();

    return Util.round(+(raw?.native ?? 0), 8);
  }

  private async nativeBalanceInPeriod(accountId: number, from: Date, to: Date): Promise<number> {
    const raw = await this.ledgerLegRepository
      .createQueryBuilder('leg')
      .innerJoin('leg.tx', 'tx')
      .select('SUM(leg.amount)', 'native')
      .where('leg.accountId = :accountId', { accountId })
      .andWhere('tx.bookingDate >= :from', { from })
      .andWhere('tx.bookingDate <= :to', { to })
      .getRawOne<{ native: string | null }>();

    return Util.round(+(raw?.native ?? 0), 8);
  }

  // all native journal balances in ONE GROUP-BY pass (Σ leg.amount per account, all-time) for getReconStatus.
  // alias.property refs (leg.accountId, SUM(leg.amount)) are auto-quoted by TypeORM — no bare camelCase column.
  // Unlike balancesByAccount this joins no tx and applies no bookingDate filter → the all-time journal balance.
  private async nativeBalanceByAccount(): Promise<Map<number, number>> {
    const raw = await this.ledgerLegRepository
      .createQueryBuilder('leg')
      .select('leg.accountId', 'accountId')
      .addSelect('SUM(leg.amount)', 'native')
      .groupBy('leg.accountId')
      .getRawMany<{ accountId: number; native: string }>();

    return new Map(raw.map((r) => [+r.accountId, Util.round(+r.native, 8)]));
  }

  // for each leg, the counter account = the other account when the tx is a clean 2-leg booking
  private async mapLegsWithCounterAccount(legs: LedgerLeg[], accountId: number): Promise<LedgerLegEntryDto[]> {
    const txIds = Array.from(new Set(legs.map((l) => l.txId)));
    const counterByTxId = await this.counterAccountByTxId(txIds, accountId);

    return legs.map((leg) =>
      LedgerDtoMapper.mapLegEntry(leg, leg.tx.bookingDate, leg.tx.valueDate, counterByTxId.get(leg.txId)),
    );
  }

  // counter account: the single other account of a 2-leg tx (undefined for ≥3-leg txs — no single counter party)
  private async counterAccountByTxId(txIds: number[], accountId: number): Promise<Map<number, LedgerAccount>> {
    if (!txIds.length) return new Map();

    const legs = await this.ledgerLegRepository.find({
      where: { tx: { id: In(txIds) } },
      relations: { account: true, tx: true },
    });

    const byTx = Util.groupBy<LedgerLeg, number>(legs, 'txId');
    const result = new Map<number, LedgerAccount>();
    for (const [txId, txLegs] of byTx.entries()) {
      const counterparts = txLegs.filter((l) => l.accountId !== accountId);
      if (counterparts.length === 1) result.set(txId, counterparts[0].account);
    }

    return result;
  }

  // --- RECONCILIATION HELPERS (reuse LedgerReconciliationService.classifyFeed) --- //

  private async feedByAssetId(): Promise<Map<number, LiquidityBalance>> {
    const feed = await this.liquidityManagementBalanceService.getBalances();
    return new Map(feed.filter((b) => b.asset?.id != null).map((b) => [b.asset.id, b]));
  }

  // ASSET-account recon snapshot for the balance list (non-ASSET accounts carry no feed → no snapshot)
  private reconSnapshot(
    account: LedgerAccount,
    ledgerBalance: number,
    feedByAssetId: Map<number, LiquidityBalance>,
    marks: LedgerMarkCache,
    now: Date,
  ): AccountReconSnapshot | undefined {
    if (account.type !== AccountType.ASSET || account.assetId == null) return undefined;

    const result = this.reconResult(account, ledgerBalance, feedByAssetId, marks, now);
    return {
      reconStatus: this.toReconStatus(result.status),
      reconDiff: result.difference,
      lastVerified: result.staleness === LedgerFeedStaleness.FRESH ? result.feedTimestamp : undefined,
    };
  }

  // the list-view reconStatus (LedgerReconStatus) derived from the recon result status (LedgerReconResultStatus).
  // These are DISTINCT enums: the list has no SUSPENSE_ALARM member, so a suspense alarm surfaces as `diff` here.
  private toReconStatus(status: LedgerReconResultStatus): LedgerReconStatus {
    switch (status) {
      case LedgerReconResultStatus.SUSPENSE_ALARM:
        return LedgerReconStatus.DIFF; // suspense alarm surfaces as diff in the list
      case LedgerReconResultStatus.DIFF:
        return LedgerReconStatus.DIFF;
      case LedgerReconResultStatus.STALE:
        return LedgerReconStatus.STALE;
      case LedgerReconResultStatus.UNVERIFIED:
        return LedgerReconStatus.UNVERIFIED;
      case LedgerReconResultStatus.OK:
        return LedgerReconStatus.OK;
    }
  }

  private reconResult(
    account: LedgerAccount,
    ledgerBalance: number,
    feedByAssetId: Map<number, LiquidityBalance>,
    marks: LedgerMarkCache,
    now: Date,
  ): AccountReconResult {
    const balance = account.assetId != null ? feedByAssetId.get(account.assetId) : undefined;
    const classification = this.reconciliationService.classifyFeed(balance, account, now);

    const externalFeedBalance = balance?.amount ?? 0;
    const difference = Util.round(ledgerBalance - externalFeedBalance, 8);
    const feedTimestamp = balance?.updated;
    const feedAge = feedTimestamp ? Util.hoursDiff(feedTimestamp, now) : undefined;

    // §7 unit fix: the tolerance check is in CHF, so value the native diff via the account's mark (see mapReconStatus)
    const mark = account.assetId != null ? marks.getMarkAt(account.assetId, now) : undefined;

    const staleness = this.mapStaleness(classification.status);
    const status = this.mapReconStatus(classification.status, difference, mark);

    return { account, ledgerBalance, externalFeedBalance, difference, feedTimestamp, feedAge, staleness, status };
  }

  private mapStaleness(status: FeedStatus): LedgerFeedStaleness {
    switch (status) {
      case FeedStatus.FRESH:
        return LedgerFeedStaleness.FRESH;
      case FeedStatus.STALE:
        return LedgerFeedStaleness.STALE;
      case FeedStatus.PLACEHOLDER:
        return LedgerFeedStaleness.PLACEHOLDER;
      case FeedStatus.NO_FEED:
        return LedgerFeedStaleness.MISSING;
    }
  }

  private mapReconStatus(status: FeedStatus, difference: number, mark: number | undefined): LedgerReconResultStatus {
    if (status === FeedStatus.STALE) return LedgerReconResultStatus.STALE;
    if (status !== FeedStatus.FRESH) return LedgerReconResultStatus.UNVERIFIED; // placeholder / no-feed (§7.2)

    // §7 unit fix: value the native journal↔feed diff in CHF (× mark) before the CHF-tolerance check; no mark →
    // unverified (same as the job), NEVER silently ok (that would mask a real discrepancy).
    if (mark == null) return LedgerReconResultStatus.UNVERIFIED;
    const diffChf = Util.round(difference * mark, 2);
    return Math.abs(diffChf) <= Config.ledger.reconciliationToleranceChf
      ? LedgerReconResultStatus.OK
      : LedgerReconResultStatus.DIFF;
  }

  // --- MARGIN HELPERS (§1.11/§7.6) --- //

  private async marginBuckets(
    from: Date,
    to: Date,
    dailySample: boolean,
  ): Promise<{ date: string; feeIncome: number; executionCosts: number; otherOpex: number; fxPnl: number }[]> {
    // spread-* glob ALWAYS combined with the account TYPE (Minor R12-4): INCOME→feeIncome, EXPENSE→executionCosts.
    const bucketExpr = dailySample ? 'CAST(tx.bookingDate AS DATE)' : `'all'`;
    const rows = await this.ledgerLegRepository
      .createQueryBuilder('leg')
      .innerJoin('leg.tx', 'tx')
      .innerJoin('leg.account', 'account')
      .select(bucketExpr, 'bucket')
      .addSelect('account.type', 'type')
      .addSelect('account.name', 'name')
      .addSelect('SUM(COALESCE(leg.amountChf, 0))', 'chf')
      .where('tx.bookingDate >= :from', { from })
      .andWhere('tx.bookingDate <= :to', { to })
      .andWhere('account.type IN (:...types)', { types: [AccountType.INCOME, AccountType.EXPENSE] })
      .groupBy(bucketExpr)
      .addGroupBy('account.type')
      .addGroupBy('account.name')
      .getRawMany<{ bucket: string; type: AccountType; name: string; chf: string }>();

    const byBucket = new Map<string, { feeIncome: number; executionCosts: number; otherOpex: number; fxPnl: number }>();
    for (const row of rows) {
      const bucket = this.bucketKey(row.bucket);
      const acc = byBucket.get(bucket) ?? { feeIncome: 0, executionCosts: 0, otherOpex: 0, fxPnl: 0 };

      // signed Σ amountChf per account: INCOME accounts carry Cr (negative) balances, EXPENSE Dr (positive).
      // The report exposes positive magnitudes, so income contributes −chf and expense +chf.
      const chf = +row.chf;
      if (this.isFxRevaluation(row.name)) {
        acc.fxPnl += -chf; // */fx-revaluation: net INCOME(−) − EXPENSE(+) → positive = net FX gain
      } else if (row.type === AccountType.INCOME) {
        acc.feeIncome += -chf; // INCOME/fee-*, INCOME/trading, INCOME/spread-* (type-filtered, Minor R12-4)
      } else if (this.isOtherOpex(row.name)) {
        acc.otherOpex += chf; // EXPENSE/refReward + EXPENSE/extraordinary (Major R7-2)
      } else {
        acc.executionCosts += chf; // EXPENSE/spread-*, network-fee, bank-fee, acquirer-fee (type-filtered)
      }

      byBucket.set(bucket, acc);
    }

    return Array.from(byBucket.entries())
      .map(([date, v]) => ({
        date,
        feeIncome: Util.round(v.feeIncome, 2),
        executionCosts: Util.round(v.executionCosts, 2),
        otherOpex: Util.round(v.otherOpex, 2),
        fxPnl: Util.round(v.fxPnl, 2),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  private isFxRevaluation(name: string): boolean {
    return name.endsWith('/fx-revaluation');
  }

  private isOtherOpex(name: string): boolean {
    return name === 'EXPENSE/refReward' || name === 'EXPENSE/extraordinary';
  }

  // --- EQUITY-COMPARISON HELPERS (§7.6) --- //

  // §7.6 (perf c): ONE day-grouped pass over ledger_leg → the four equity components per day (bookingDate ≤ `to`),
  // accumulated into a running cumulative in memory. Same four components as the former per-period helpers
  // (journalEquity over the balance-account types; transitPhantom = TRANSIT; staleFeed = mark_to_market legs on the
  // currently-unverified accounts; spreadFees = EXPENSE minus refReward/extraordinary/fx-revaluation). PG-quoting:
  // alias.property refs (`tx.bookingDate`, `account.type`, `leg.amountChf`) are auto-quoted by TypeORM — no camelCase
  // column is referenced bare in the raw CASE expressions.
  private async cumulativeEquityByDay(to: Date, unverifiedAccountIds: number[]): Promise<EquityDayAgg[]> {
    const equityTypes = [
      AccountType.ASSET,
      AccountType.TRANSIT,
      AccountType.LIABILITY,
      AccountType.SUSPENSE,
      AccountType.ROUNDING,
    ];
    const excludedSpreadNames = ['EXPENSE/refReward', 'EXPENSE/extraordinary', 'EXPENSE/fx-revaluation'];

    const qb = this.ledgerLegRepository
      .createQueryBuilder('leg')
      .innerJoin('leg.tx', 'tx')
      .innerJoin('leg.account', 'account')
      .select('CAST(tx.bookingDate AS DATE)', 'day')
      .addSelect(
        'SUM(CASE WHEN account.type IN (:...equityTypes) THEN COALESCE(leg.amountChf, 0) ELSE 0 END)',
        'equity',
      )
      .addSelect('SUM(CASE WHEN account.type = :transitType THEN COALESCE(leg.amountChf, 0) ELSE 0 END)', 'transit')
      .addSelect(
        'SUM(CASE WHEN account.type = :expenseType AND account.name NOT IN (:...excludedSpreadNames) THEN COALESCE(leg.amountChf, 0) ELSE 0 END)',
        'spread',
      );

    const params: Record<string, unknown> = {
      to,
      equityTypes,
      transitType: AccountType.TRANSIT,
      expenseType: AccountType.EXPENSE,
      excludedSpreadNames,
      scanTypes: [...equityTypes, AccountType.EXPENSE], // bound the scan to types that feed any component
    };

    // Class-3 stale-feed only exists when at least one account is unverified (SQL `IN ()` is invalid → literal 0)
    if (unverifiedAccountIds.length) {
      qb.addSelect(
        'SUM(CASE WHEN tx.sourceType = :markSource AND leg.accountId IN (:...unverifiedAccountIds) THEN COALESCE(leg.amountChf, 0) ELSE 0 END)',
        'stale',
      );
      params.markSource = MARK_TO_MARKET_SOURCE;
      params.unverifiedAccountIds = unverifiedAccountIds;
    } else {
      qb.addSelect('0', 'stale');
    }

    const rows = await qb
      .where('tx.bookingDate <= :to')
      .andWhere('account.type IN (:...scanTypes)')
      .groupBy('CAST(tx.bookingDate AS DATE)')
      .setParameters(params)
      .getRawMany<{ day: string; equity: string; transit: string; stale: string; spread: string }>();

    // ascending by day, running cumulative — each period reads the cumulative as of its own day (cumulativeAt)
    let equity = 0;
    let transit = 0;
    let stale = 0;
    let spread = 0;

    return rows
      .map((r) => ({
        day: this.bucketKey(r.day),
        equity: +r.equity,
        transit: +r.transit,
        stale: +r.stale,
        spread: +r.spread,
      }))
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((r) => {
        equity += r.equity;
        transit += r.transit;
        stale += r.stale;
        spread += r.spread;
        return { day: r.day, equity, transit, stale, spread };
      });
  }

  // cumulative component totals as of `at` = the latest day-bucket with day ≤ at's UTC day (all-0 if none precedes it)
  private cumulativeAt(cumulative: EquityDayAgg[], at: Date): EquityDayAgg {
    const dayKey = at.toISOString().slice(0, 10);
    let result: EquityDayAgg = { day: dayKey, equity: 0, transit: 0, stale: 0, spread: 0 };
    for (const c of cumulative) {
      if (c.day <= dayKey) result = c;
      else break;
    }
    return result;
  }

  private async unverifiedAccountIds(): Promise<number[]> {
    const now = new Date();
    const accounts = await this.ledgerAccountRepository.find({
      where: { type: AccountType.ASSET, active: true },
      relations: { asset: { bank: true } },
    });
    const feedByAssetId = await this.feedByAssetId();

    return accounts
      .filter((account) => {
        if (account.assetId == null) return false;
        const status = this.reconciliationService.classifyFeed(feedByAssetId.get(account.assetId), account, now).status;
        return status !== FeedStatus.FRESH && status !== FeedStatus.PLACEHOLDER;
      })
      .map((account) => account.id);
  }

  // --- SHARED HELPERS --- //

  private resolvePeriod(from: Date | undefined, to: Date | undefined, now: Date): { from: Date; to: Date } {
    return { from: from ?? new Date(0), to: to ?? now };
  }

  private bucketKey(bucket: string): string {
    // CAST(... AS DATE) returns a Date/string per driver; normalise to a YYYY-MM-DD day key
    if (bucket === 'all') return 'all';
    return new Date(bucket).toISOString().slice(0, 10);
  }

  private parseFinance(message: string): FinanceLog | undefined {
    try {
      return JSON.parse(message) as FinanceLog;
    } catch {
      return undefined;
    }
  }
}
