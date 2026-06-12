import { Injectable } from '@nestjs/common';
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
import { FeedStatus, LedgerReconciliationService } from './ledger-reconciliation.service';

const LEGS_PAGE_SIZE = 100;
const MARK_TO_MARKET_SOURCE = 'mark_to_market';

/**
 * Read-only query layer for the ADMIN ledger endpoints (§8). Pure observer: it only reads from ledger_* plus the
 * whitelisted feed read (LiquidityManagementBalanceService.getBalances, §7.0/§4.10) and the read-only LogService
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
    private readonly logService: LogService,
  ) {}

  // --- GET ledger/accounts (balance list) --- //

  async getAccounts(from?: Date, to?: Date): Promise<LedgerAccountsResponseDto> {
    const now = new Date();
    const period = this.resolvePeriod(from, to, now);

    const accounts = await this.ledgerAccountRepository.find({ relations: { asset: { bank: true } } });
    const balances = await this.balancesByAccount(period.to);

    // ASSET-account recon snapshot for the list (against the persisted feed, §7) — feed read once for all accounts
    const feedByAssetId = await this.feedByAssetId();

    const accountDtos: LedgerAccountBalanceDto[] = accounts.map((account) => {
      const balance: AccountBalance = {
        account,
        balanceNative: balances.get(account.id)?.native ?? 0,
        balanceChf: balances.get(account.id)?.chf ?? 0,
      };
      const recon = this.reconSnapshot(account, balance.balanceNative, feedByAssetId, now);
      return LedgerDtoMapper.mapAccountBalance(balance, recon);
    });

    return { period: LedgerDtoMapper.mapPeriod(period.from, period.to), accounts: accountDtos };
  }

  // --- GET ledger/accounts/:accountId/legs (T-account legs, paginated §8) --- //

  async getAccountDetail(accountId: number, from?: Date, to?: Date, page = 0): Promise<LedgerLegsResponseDto> {
    const now = new Date();
    const period = this.resolvePeriod(from, to, now);

    const account = await this.ledgerAccountRepository.findOneBy({ id: accountId });
    if (!account) {
      return {
        accountId,
        accountName: '',
        currency: '',
        period: LedgerDtoMapper.mapPeriod(period.from, period.to),
        openingBalance: 0,
        closingBalance: 0,
        legs: [],
        total: 0,
      };
    }

    // opening balance = signed native Σ of all legs booked strictly before the period start
    const openingBalance = await this.nativeBalanceBefore(accountId, period.from);
    const periodNative = await this.nativeBalanceInPeriod(accountId, period.from, period.to);
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

    const accounts = await this.ledgerAccountRepository.find({
      where: { type: AccountType.ASSET, active: true },
      relations: { asset: { bank: true } },
    });
    const feedByAssetId = await this.feedByAssetId();

    const results: AccountReconResultDto[] = [];
    for (const account of accounts) {
      if (account.assetId == null) continue;

      const ledgerBalance = await this.journalNativeBalance(account.id);
      const result = this.reconResult(account, ledgerBalance, feedByAssetId, now);
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
    const logs = await this.logService.getFinancialLogs(from, dailySample);

    const periods: EquityComparisonPeriodDto[] = [];
    for (const log of logs) {
      const finance = this.parseFinance(log.message);
      const financialDataLogTotal = finance?.balancesTotal?.totalBalanceChf;
      if (financialDataLogTotal == null) continue;

      const journalEquity = await this.journalEquityAt(log.created);
      const difference = Util.round(journalEquity - financialDataLogTotal, 2);
      const decomposition = await this.equityDecomposition(log.created, difference);

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

  private async journalNativeBalance(accountId: number): Promise<number> {
    const raw = await this.ledgerLegRepository
      .createQueryBuilder('leg')
      .select('SUM(leg.amount)', 'native')
      .where('leg.accountId = :accountId', { accountId })
      .getRawOne<{ native: string | null }>();

    return Util.round(+(raw?.native ?? 0), 8);
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
    now: Date,
  ): AccountReconSnapshot | undefined {
    if (account.type !== AccountType.ASSET || account.assetId == null) return undefined;

    const result = this.reconResult(account, ledgerBalance, feedByAssetId, now);
    return {
      reconStatus: result.status === 'suspense_alarm' ? 'diff' : result.status,
      reconDiff: result.difference,
      lastVerified: result.staleness === 'fresh' ? result.feedTimestamp : undefined,
    };
  }

  private reconResult(
    account: LedgerAccount,
    ledgerBalance: number,
    feedByAssetId: Map<number, LiquidityBalance>,
    now: Date,
  ): AccountReconResult {
    const balance = account.assetId != null ? feedByAssetId.get(account.assetId) : undefined;
    const classification = this.reconciliationService.classifyFeed(balance, account, now);

    const externalFeedBalance = balance?.amount ?? 0;
    const difference = Util.round(ledgerBalance - externalFeedBalance, 8);
    const feedTimestamp = balance?.updated;
    const feedAge = feedTimestamp ? Util.hoursDiff(feedTimestamp, now) : undefined;

    const staleness = this.mapStaleness(classification.status);
    const status = this.mapReconStatus(classification.status, difference);

    return { account, ledgerBalance, externalFeedBalance, difference, feedTimestamp, feedAge, staleness, status };
  }

  private mapStaleness(status: FeedStatus): LedgerFeedStaleness {
    switch (status) {
      case FeedStatus.FRESH:
        return 'fresh';
      case FeedStatus.STALE:
        return 'stale';
      case FeedStatus.PLACEHOLDER:
        return 'placeholder';
      case FeedStatus.NO_FEED:
      default:
        return 'missing';
    }
  }

  private mapReconStatus(status: FeedStatus, difference: number): LedgerReconResultStatus {
    if (status === FeedStatus.STALE) return 'stale';
    if (status !== FeedStatus.FRESH) return 'unverified'; // placeholder / no-feed → unverified (§7.2)

    return Math.abs(difference) <= Config.ledger.reconciliationToleranceChf ? 'ok' : 'diff';
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

  // signed Σ amountChf over the balance-account types up to `at` (Dr +, Cr − already in the leg sign convention, §2.3)
  private async journalEquityAt(at: Date): Promise<number> {
    const raw = await this.ledgerLegRepository
      .createQueryBuilder('leg')
      .innerJoin('leg.tx', 'tx')
      .innerJoin('leg.account', 'account')
      .select('SUM(COALESCE(leg.amountChf, 0))', 'chf')
      .where('tx.bookingDate <= :at', { at })
      .andWhere('account.type IN (:...types)', {
        types: [
          AccountType.ASSET,
          AccountType.TRANSIT,
          AccountType.LIABILITY,
          AccountType.SUSPENSE,
          AccountType.ROUNDING,
        ],
      })
      .getRawOne<{ chf: string | null }>();

    return Util.round(+(raw?.chf ?? 0), 2);
  }

  // three buckets aggregated independently from ledger_* (Minor R13-5); `other` is the only residual (Class-5).
  private async equityDecomposition(at: Date, difference: number): Promise<EquityDecompositionDto> {
    const transitPhantom = await this.transitPhantom(at);
    const staleFeed = await this.staleFeed(at);
    const spreadFees = await this.spreadFees(at);
    const other = Util.round(difference - (transitPhantom + staleFeed + spreadFees), 2);

    return { transitPhantom, staleFeed, spreadFees, other };
  }

  private async transitPhantom(at: Date): Promise<number> {
    const raw = await this.ledgerLegRepository
      .createQueryBuilder('leg')
      .innerJoin('leg.tx', 'tx')
      .innerJoin('leg.account', 'account')
      .select('SUM(COALESCE(leg.amountChf, 0))', 'chf')
      .where('tx.bookingDate <= :at', { at })
      .andWhere('account.type = :type', { type: AccountType.TRANSIT })
      .getRawOne<{ chf: string | null }>();

    return Util.round(+(raw?.chf ?? 0), 2);
  }

  // Class-3: mark_to_market fx-revaluation legs on accounts that are currently unverified
  private async staleFeed(at: Date): Promise<number> {
    const unverifiedAccountIds = await this.unverifiedAccountIds();
    if (!unverifiedAccountIds.length) return 0;

    const raw = await this.ledgerLegRepository
      .createQueryBuilder('leg')
      .innerJoin('leg.tx', 'tx')
      .select('SUM(COALESCE(leg.amountChf, 0))', 'chf')
      .where('tx.bookingDate <= :at', { at })
      .andWhere('tx.sourceType = :sourceType', { sourceType: MARK_TO_MARKET_SOURCE })
      .andWhere('leg.accountId IN (:...ids)', { ids: unverifiedAccountIds })
      .getRawOne<{ chf: string | null }>();

    return Util.round(+(raw?.chf ?? 0), 2);
  }

  // Class-6: Σ EXPENSE/spread-* + EXPENSE/network-fee (+ bank-fee, acquirer-fee) = executionCosts (type=EXPENSE)
  private async spreadFees(at: Date): Promise<number> {
    const raw = await this.ledgerLegRepository
      .createQueryBuilder('leg')
      .innerJoin('leg.tx', 'tx')
      .innerJoin('leg.account', 'account')
      .select('SUM(COALESCE(leg.amountChf, 0))', 'chf')
      .where('tx.bookingDate <= :at', { at })
      .andWhere('account.type = :type', { type: AccountType.EXPENSE })
      .andWhere('account.name NOT IN (:...excluded)', {
        excluded: ['EXPENSE/refReward', 'EXPENSE/extraordinary', 'EXPENSE/fx-revaluation'],
      })
      .getRawOne<{ chf: string | null }>();

    return Util.round(+(raw?.chf ?? 0), 2);
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
