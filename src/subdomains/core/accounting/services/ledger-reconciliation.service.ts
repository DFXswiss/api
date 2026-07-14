import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { LiquidityBalance } from 'src/subdomains/core/liquidity-management/entities/liquidity-balance.entity';
import { LiquidityManagementBalanceService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-balance.service';
import { RefRewardService } from 'src/subdomains/core/referral/reward/services/ref-reward.service';
import { LogService } from 'src/subdomains/supporting/log/log.service';
import { FinanceLog } from 'src/subdomains/supporting/log/dto/log.dto';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailRequest } from 'src/subdomains/supporting/notification/interfaces';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { MoreThan } from 'typeorm';
import { AccountType, LedgerAccount } from '../entities/ledger-account.entity';
import { LedgerAccountRepository } from '../repositories/ledger-account.repository';
import { LedgerLegRepository } from '../repositories/ledger-leg.repository';
import { LedgerBookingJobService } from './ledger-booking-job.service';
import { LedgerMarkCache, LedgerMarkService } from './ledger-mark.service';

const PLACEHOLDER_AMOUNT = 1.0; // Scrypt/EUR, Base/ZCHF placeholder feed → never reconcile (§7.1)

// §7.6: median window for the equity-parity baseline. The FinancialDataLog carries transient ±snapshot-skew spikes
// (see BalancesTotal, case 4); comparing against the median of the last few VALID snapshots absorbs a single spike.
const EQUITY_PARITY_MEDIAN_SAMPLE = 5;

export enum FeedStatus {
  PLACEHOLDER = 'Placeholder',
  FRESH = 'Fresh',
  STALE = 'Stale',
  NO_FEED = 'NoFeed',
}

// §7.1 custody classification → staleness threshold (hours)
enum CustodyClass {
  BANK_ACTIVE = 'BankActive',
  BANK_DEAD = 'BankDead',
  ON_CHAIN_ACTIVE = 'OnChainActive',
  ON_CHAIN_INACTIVE = 'OnChainInactive',
  EXCHANGE_ACTIVE = 'ExchangeActive',
  EXCHANGE_ORDER_DRIVEN = 'ExchangeOrderDriven',
  EXCHANGE_FEEDLESS = 'ExchangeFeedless',
}

const STALENESS_THRESHOLD_HOURS: Record<CustodyClass, number> = {
  [CustodyClass.BANK_ACTIVE]: 96, // SEPA banks
  [CustodyClass.BANK_DEAD]: 7 * 24, // 7d once, then unverified
  [CustodyClass.ON_CHAIN_ACTIVE]: 4,
  [CustodyClass.ON_CHAIN_INACTIVE]: 24,
  [CustodyClass.EXCHANGE_ACTIVE]: 4,
  [CustodyClass.EXCHANGE_ORDER_DRIVEN]: 48,
  [CustodyClass.EXCHANGE_FEEDLESS]: 0, // unverified from start
};

export interface FeedClassification {
  status: FeedStatus;
  custodyClass: CustodyClass;
  thresholdHours: number;
}

/**
 * Daily reconciliation (§7). Compares the journal balance (Σ ledger_leg.amount per ASSET account) against the
 * persisted feed (liquidity_balance.amount via getBalances — NEVER a fresh API call, §7.0). Pure observer: the
 * only non-ledger_* write is the sanctioned notification-write via NotificationService.sendMail (§7.5/Major R12-1).
 *
 * Runs off-peak at 05:00 — 1h AFTER the mark-to-market job (§5.3, 04:00) so it compares against same-day
 * revalued accounts (Minor R13-8). Staleness drives unverified status + suppressed alarms (§7.2/§7.3); transit-age
 * (§7.4), suspense (§7.5) and equity-parity (§7.6) alarms follow.
 */
@Injectable()
export class LedgerReconciliationService {
  private readonly logger = new DfxLogger(LedgerReconciliationService);

  constructor(
    private readonly jobService: LedgerBookingJobService,
    private readonly settingService: SettingService,
    private readonly logService: LogService,
    private readonly notificationService: NotificationService,
    private readonly liquidityManagementBalanceService: LiquidityManagementBalanceService,
    private readonly ledgerAccountRepository: LedgerAccountRepository,
    private readonly ledgerLegRepository: LedgerLegRepository,
    private readonly markService: LedgerMarkService,
    private readonly refRewardService: RefRewardService,
  ) {}

  @DfxCron(CronExpression.EVERY_DAY_AT_5AM, { process: Process.LEDGER_RECONCILIATION })
  async run(): Promise<void> {
    if (!(await this.jobService.isLedgerReady())) return; // cutover-gate (Blocker R1-6)

    await this.reconcile();
  }

  private async reconcile(): Promise<void> {
    const now = new Date();

    // §7.0: feed read ONCE per run, held in-memory for all batches (never per-batch, Minor R13-2)
    const feed = await this.liquidityManagementBalanceService.getBalances();

    // §7 (unit fix): marks loaded ONCE per run (analog mark-to-market §5.2, same 2-day window). Used to value the
    // native journal↔feed diff in CHF before comparing against the CHF tolerance (see reconcileFreshAsset).
    const marks = await this.markService.preload(Util.daysBefore(2, now), now);

    await this.reconcileAssets(feed, marks, now);
    await this.checkTransitAge(now);
    await this.checkSuspense();
    await this.checkEquityParity(now);
  }

  // --- ASSET RECONCILIATION (§7.1/§7.2/§7.3) --- //

  private async reconcileAssets(feed: LiquidityBalance[], marks: LedgerMarkCache, now: Date): Promise<void> {
    const feedByAssetId = new Map(feed.filter((b) => b.asset?.id != null).map((b) => [b.asset.id, b]));

    const unverified: string[] = [];

    // §7.0 (Minor R13-2): paginate the ASSET-account universe in backfillBatchSize windows by id-watermark — the
    // feed (loaded once in reconcile()) stays in-memory for ALL batches. "batch-limited" means a batched ITERATION
    // over EVERY account, NOT a truncation to the first batchSize accounts (which would silently never reconcile
    // accounts 101+ once the asset universe grows past the batch size — a monitoring blind spot, MAJOR).
    const batchSize = Config.ledger.backfillBatchSize;
    let lastId = 0;
    for (;;) {
      const assetAccounts = await this.ledgerAccountRepository.find({
        where: { type: AccountType.ASSET, active: true, id: MoreThan(lastId) },
        order: { id: 'ASC' },
        take: batchSize,
      });
      if (!assetAccounts.length) break;

      for (const account of assetAccounts) {
        if (account.assetId == null) continue;

        const balance = feedByAssetId.get(account.assetId);
        const classification = this.classifyFeed(balance, account, now);

        // placeholder (amount=1.0): skip reconciliation, log warning, no diff alarm (§7.1)
        if (classification.status === FeedStatus.PLACEHOLDER) {
          this.logger.verbose(`Skipping reconciliation for ${account.name}: placeholder feed (amount=1.0)`);
          continue;
        }

        if (classification.status !== FeedStatus.FRESH) {
          unverified.push(`${account.name} (${classification.status}, ${classification.custodyClass})`);
          continue; // unverified → no per-asset diff alarm, aggregated below (§7.2/§7.3)
        }

        // §7 (unit fix): the native journal↔feed diff MUST be valued in CHF (× the current mark) before it is
        // compared against the CHF-denominated tolerance — a native tolerance is ~52'000× too loose for BTC and far
        // too tight for meme-coins. No mark available → treat the account as unverified (same as the staleness path),
        // NEVER silently value the diff at 0 (that would mask a real discrepancy).
        const mark = marks.getMarkAt(account.assetId, now);
        if (mark == null) {
          unverified.push(`${account.name} (no-mark, ${classification.custodyClass})`);
          continue;
        }

        await this.reconcileFreshAsset(account, balance, mark, now);
      }

      lastId = assetAccounts[assetAccounts.length - 1].id;
      if (assetAccounts.length < batchSize) break; // last (partial) page → exhausted
    }

    // §7.3: one aggregated "Unverified Accounts" alarm per day (no per-asset spam)
    if (unverified.length) {
      await this.sendAlarm(
        MailContext.LEDGER_RECONCILIATION,
        'Ledger unverified accounts',
        [`${unverified.length} account(s) without a fresh feed:`, ...unverified],
        `ledger-unverified-${this.dayKey(now)}`,
      );
    }
  }

  // §7.1 staleness classification incl. placeholder rule
  classifyFeed(balance: LiquidityBalance | undefined, account: LedgerAccount, now: Date): FeedClassification {
    const custodyClass = this.classifyCustody(account.asset);
    const thresholdHours = STALENESS_THRESHOLD_HOURS[custodyClass];

    if (!balance || balance.amount == null) {
      return { status: FeedStatus.NO_FEED, custodyClass, thresholdHours };
    }
    if (balance.amount === PLACEHOLDER_AMOUNT) {
      return { status: FeedStatus.PLACEHOLDER, custodyClass, thresholdHours };
    }
    if (custodyClass === CustodyClass.EXCHANGE_FEEDLESS) {
      return { status: FeedStatus.NO_FEED, custodyClass, thresholdHours }; // unverified from start (§7.1)
    }

    const ageHours = Util.hoursDiff(balance.updated, now);
    return {
      status: ageHours > thresholdHours ? FeedStatus.STALE : FeedStatus.FRESH,
      custodyClass,
      thresholdHours,
    };
  }

  // §7.1 custody-type → class. On-chain assets are blockchain-backed; bank/exchange assets are CUSTODY rows.
  private classifyCustody(asset: Asset | undefined): CustodyClass {
    if (!asset) return CustodyClass.ON_CHAIN_INACTIVE;

    // bank custody (asset linked to a Bank) → SEPA active threshold
    if (asset.bank) return CustodyClass.BANK_ACTIVE;

    // exchange/feedless custody rows carry a non-blockchain custody marker
    const blockchain = asset.blockchain;
    const isOnChain = blockchain != null && blockchain !== Blockchain.KRAKEN && blockchain !== Blockchain.BINANCE;

    return isOnChain ? CustodyClass.ON_CHAIN_ACTIVE : CustodyClass.EXCHANGE_ACTIVE;
  }

  // §7: compare journal balance vs feed within tolerance; on diff → alarm (the journal stays authoritative, observer).
  // The diff is native (leg.amount ≡ liquidity_balance.amount) and is valued at `mark` (CHF per native unit) so it is
  // compared against the CHF-denominated tolerance in the SAME unit (§7 unit fix).
  private async reconcileFreshAsset(
    account: LedgerAccount,
    balance: LiquidityBalance,
    mark: number,
    now: Date,
  ): Promise<void> {
    const journal = await this.journalNativeBalance(account.id);
    const feedAmount = balance.amount ?? 0;
    const diff = Util.round(journal - feedAmount, 8);
    const diffChf = Util.round(diff * mark, 2);

    if (Math.abs(diffChf) <= Config.ledger.reconciliationToleranceChf) return; // within CHF tolerance → balanced

    await this.sendAlarm(
      MailContext.LEDGER_RECONCILIATION,
      'Ledger reconciliation diff',
      [
        `${account.name}: journal ${journal} vs feed ${feedAmount} (diff ${diff} native, ${diffChf} CHF @ mark ${mark})`,
      ],
      `ledger-recon-${account.id}-${this.dayKey(now)}`,
    );
  }

  // --- TRANSIT-AGE (§7.4) --- //

  // transit account with balance ≠ 0 older than route threshold → alarm; age = MIN(bookingDate) of open legs.
  // bookingDate lives on ledger_tx, NOT ledger_leg — the aggregate MUST join leg.tx and read MIN(tx.bookingDate)
  // (a MIN(leg.bookingDate) references a non-existent column and crashes the whole reconciliation run on real PG).
  private async checkTransitAge(now: Date): Promise<void> {
    const overdue = await this.ledgerLegRepository
      .createQueryBuilder('leg')
      .innerJoin('leg.account', 'account')
      .innerJoin('leg.tx', 'tx')
      .select('account.name', 'name')
      .addSelect('SUM(leg.amount)', 'native')
      .addSelect('MIN(tx.bookingDate)', 'oldest')
      .where('account.type = :type', { type: AccountType.TRANSIT })
      .groupBy('account.id')
      .addGroupBy('account.name')
      .having('ABS(SUM(leg.amount)) > :tol', { tol: 1e-8 })
      .getRawMany<{ name: string; native: string; oldest: Date }>();

    const thresholdDays = Config.ledger.transitAlarmThresholdDays;
    const aged = overdue.filter((t) => t.oldest && Util.daysDiff(new Date(t.oldest), now) > thresholdDays);
    if (!aged.length) return;

    await this.sendAlarm(
      MailContext.LEDGER_TRANSIT_OVERDUE,
      'Ledger transit overdue',
      aged.map((t) => `${t.name}: balance ${t.native} open since ${new Date(t.oldest).toISOString()}`),
      `ledger-transit-${this.dayKey(now)}`,
    );
  }

  // --- SUSPENSE (§7.5) --- //

  // each SUSPENSE account with a balance ≠ 0 above its threshold → alarm
  private async checkSuspense(): Promise<void> {
    const suspense = await this.ledgerLegRepository
      .createQueryBuilder('leg')
      .innerJoin('leg.account', 'account')
      .select('account.name', 'name')
      .addSelect('SUM(COALESCE(leg.amountChf, 0))', 'chf')
      .where('account.type = :type', { type: AccountType.SUSPENSE })
      .groupBy('account.id')
      .addGroupBy('account.name')
      .having('ABS(SUM(COALESCE(leg.amountChf, 0))) > :tol', { tol: 1e-8 })
      .getRawMany<{ name: string; chf: string }>();
    if (!suspense.length) return;

    const genericThreshold = +(await this.settingService.get('ledgerSuspenseThresholdChf', '0'));
    const unroutedThreshold = +(await this.settingService.get('ledgerUnroutedDepositThresholdChf', '0'));

    const alarms = suspense.filter((s) => {
      const threshold = s.name.includes('deposit-unrouted') ? unroutedThreshold : genericThreshold;
      return Math.abs(+s.chf) > threshold;
    });
    if (!alarms.length) return;

    await this.sendAlarm(
      MailContext.LEDGER_SUSPENSE,
      'Ledger suspense balance',
      alarms.map((s) => `${s.name}: ${s.chf} CHF`),
    );
  }

  // --- EQUITY PARITY (§7.6) --- //

  // §7.6 global completeness net: every balance change ≥ threshold must be attributable to an event. journalEquity =
  // signed Σ over all balance accounts (ASSET+/TRANSIT+/LIABILITY−/SUSPENSE/ROUNDING), no leading minus (Major R8-1)
  // → positive, sign-consistent with totalBalanceChf. It is compared against a robust FinancialDataLog baseline and,
  // above a runtime threshold, raises an alarm (day-key suppressed like the peer checks). Two corrections make the
  // comparison honest:
  //   (1) Median baseline: the FinancialDataLog carries transient ±snapshot-skew spikes (BalancesTotal case 4). We
  //       compare against the MEDIAN of the last EQUITY_PARITY_MEDIAN_SAMPLE VALID snapshots, not the single latest
  //       one, so a lone spike can never trip the alarm.
  //   (2) RefCredit baseline (Finding 3): develop accrues the open referral-credit liability into totalBalanceChf
  //       (accrual basis) while the ledger books ref rewards cash basis (only at payout) → a permanent definitional
  //       gap. We fold the open RefCredit liability explicitly into the baseline and report every component so the
  //       remaining difference stays explainable, instead of adding an accrual consumer to the ledger.
  private async checkEquityParity(now: Date): Promise<void> {
    const journalEquity = await this.journalEquity();

    const snapshots = await this.logService.getLatestValidFinancialLogs(EQUITY_PARITY_MEDIAN_SAMPLE);
    const totals = snapshots
      .map((s) => this.parseFinance(s.message)?.balancesTotal?.totalBalanceChf)
      .filter((t): t is number => t != null);
    if (!totals.length) return; // no valid snapshot yet → nothing to compare against

    const medianTotalChf = Util.round(this.median(totals), 2);
    const openRefCreditChf = Util.round((await this.refRewardService.getOpenRefCreditLiability()).amountChf, 2);

    // fold the accrual-only RefCredit liability into the baseline so cash-basis ledger vs accrual-basis log align
    const adjustedDifference = Util.round(journalEquity - (medianTotalChf + openRefCreditChf), 2);

    this.logger.info(
      `Ledger equity parity: journalEquity ${journalEquity} vs medianTotalBalanceChf ${medianTotalChf} + ` +
        `openRefCreditChf ${openRefCreditChf} (adjustedDifference ${adjustedDifference}, median of ${totals.length} snapshots)`,
    );

    const threshold = +(await this.settingService.get('ledgerEquityParityThresholdChf', '0'));
    if (Math.abs(adjustedDifference) <= threshold) return; // within threshold → attributable → no alarm

    await this.sendAlarm(
      MailContext.LEDGER_EQUITY_PARITY,
      'Ledger equity parity breach',
      [
        `journalEquity ${journalEquity} CHF`,
        `medianTotalBalanceChf ${medianTotalChf} CHF (median of ${totals.length} valid snapshots)`,
        `openRefCreditChf ${openRefCreditChf} CHF`,
        `adjustedDifference ${adjustedDifference} CHF (threshold ${threshold} CHF)`,
      ],
      `ledger-equity-parity-${this.dayKey(now)}`,
    );
  }

  // median of a non-empty list (even count → mean of the two middle values); the caller guards against an empty list
  private median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  // signed Σ amountChf over the balance-account types (Dr +, Cr − already in the leg sign convention §2.3)
  private async journalEquity(): Promise<number> {
    const raw = await this.ledgerLegRepository
      .createQueryBuilder('leg')
      .innerJoin('leg.account', 'account')
      .select('SUM(COALESCE(leg.amountChf, 0))', 'chf')
      .where('account.type IN (:...types)', {
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

  // --- HELPERS --- //

  private async journalNativeBalance(accountId: number): Promise<number> {
    const raw = await this.ledgerLegRepository
      .createQueryBuilder('leg')
      .select('SUM(leg.amount)', 'native')
      .where('leg.accountId = :accountId', { accountId })
      .getRawOne<{ native: string | null }>();

    return Util.round(+(raw?.native ?? 0), 8);
  }

  // every ledger alarm goes ONLY through NotificationService.sendMail → sanctioned notification-write (Major R12-1).
  // correlationId enables NotificationService suppression (one alarm per key/day) — §7.3 alarm suppression.
  private async sendAlarm(
    context: MailContext,
    subject: string,
    errors: string[],
    correlationId?: string,
  ): Promise<void> {
    const request: MailRequest = {
      type: MailType.ERROR_MONITORING,
      context,
      input: { subject, errors },
      correlationId,
      options: correlationId ? { suppressRecurring: true } : undefined,
    };

    await this.notificationService.sendMail(request);
  }

  private parseFinance(message: string): FinanceLog | undefined {
    try {
      return JSON.parse(message) as FinanceLog;
    } catch {
      return undefined;
    }
  }

  private dayKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
