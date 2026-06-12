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
import { LogService } from 'src/subdomains/supporting/log/log.service';
import { FinanceLog } from 'src/subdomains/supporting/log/dto/log.dto';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailRequest } from 'src/subdomains/supporting/notification/interfaces';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { AccountType, LedgerAccount } from '../entities/ledger-account.entity';
import { LedgerAccountRepository } from '../repositories/ledger-account.repository';
import { LedgerLegRepository } from '../repositories/ledger-leg.repository';
import { LedgerBookingJobService } from './ledger-booking-job.service';

const PLACEHOLDER_AMOUNT = 1.0; // Scrypt/EUR, Base/ZCHF placeholder feed → never reconcile (§7.1)

export enum FeedStatus {
  PLACEHOLDER = 'placeholder',
  FRESH = 'fresh',
  STALE = 'stale',
  NO_FEED = 'no-feed',
}

// §7.1 custody classification → staleness threshold (hours)
enum CustodyClass {
  BANK_ACTIVE = 'bank-active',
  BANK_DEAD = 'bank-dead',
  ON_CHAIN_ACTIVE = 'on-chain-active',
  ON_CHAIN_INACTIVE = 'on-chain-inactive',
  EXCHANGE_ACTIVE = 'exchange-active',
  EXCHANGE_ORDER_DRIVEN = 'exchange-order-driven',
  EXCHANGE_FEEDLESS = 'exchange-feedless',
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
 * Runs off-peak at 05:00 — 1h AFTER the mark-to-market job (§5.3, 04:00) so it compares against tagesaktuell
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
  ) {}

  @DfxCron(CronExpression.EVERY_DAY_AT_5AM, { process: Process.LEDGER_RECONCILIATION })
  async run(): Promise<void> {
    if (!(await this.jobService.isLedgerReady())) return; // cutover-gate (Blocker R1-6)

    try {
      await this.reconcile();
    } catch (e) {
      this.logger.error('Ledger reconciliation failed', e);
    }
  }

  private async reconcile(): Promise<void> {
    const now = new Date();

    // §7.0: feed read ONCE per run, held in-memory for all batches (never per-batch, Minor R13-2)
    const feed = await this.liquidityManagementBalanceService.getBalances();

    await this.reconcileAssets(feed, now);
    await this.checkTransitAge(now);
    await this.checkSuspense();
    await this.checkEquityParity();
  }

  // --- ASSET RECONCILIATION (§7.1/§7.2/§7.3) --- //

  private async reconcileAssets(feed: LiquidityBalance[], now: Date): Promise<void> {
    const feedByAssetId = new Map(feed.filter((b) => b.asset?.id != null).map((b) => [b.asset.id, b]));

    const assetAccounts = await this.ledgerAccountRepository.find({
      where: { type: AccountType.ASSET, active: true },
      take: Config.ledger.backfillBatchSize,
    });

    const unverified: string[] = [];
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

      await this.reconcileFreshAsset(account, balance, now);
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

  // §7: compare journal balance vs feed within tolerance; on diff → log (the journal stays authoritative, observer)
  private async reconcileFreshAsset(account: LedgerAccount, balance: LiquidityBalance, now: Date): Promise<void> {
    const journal = await this.journalNativeBalance(account.id);
    const feedAmount = balance.amount ?? 0;
    const diff = Util.round(journal - feedAmount, 8);

    if (Math.abs(diff) <= Config.ledger.reconciliationToleranceChf) return; // within tolerance → balanced

    await this.sendAlarm(
      MailContext.LEDGER_RECONCILIATION,
      'Ledger reconciliation diff',
      [`${account.name}: journal ${journal} vs feed ${feedAmount} (diff ${diff})`],
      `ledger-recon-${account.id}-${this.dayKey(now)}`,
    );
  }

  // --- TRANSIT-AGE (§7.4) --- //

  // transit account with balance ≠ 0 older than route threshold → alarm; age = MIN(bookingDate) of open legs
  private async checkTransitAge(now: Date): Promise<void> {
    const overdue = await this.ledgerLegRepository
      .createQueryBuilder('leg')
      .innerJoin('leg.account', 'account')
      .select('account.name', 'name')
      .addSelect('SUM(leg.amount)', 'native')
      .addSelect('MIN(leg.bookingDate)', 'oldest')
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

  // journalEquity = signed Σ over all balance accounts (ASSET+/TRANSIT+/LIABILITY−/SUSPENSE/ROUNDING), no leading
  // minus (Major R8-1) → positive, sign-consistent with totalBalanceChf. Compared against the FinancialDataLog total.
  private async checkEquityParity(): Promise<void> {
    const journalEquity = await this.journalEquity();

    const snapshot = await this.logService.getLatestFinancialLog();
    const finance = snapshot ? this.parseFinance(snapshot.message) : undefined;
    if (!finance) return;

    const totalBalanceChf = finance.balancesTotal?.totalBalanceChf;
    if (totalBalanceChf == null) return;

    const difference = Util.round(journalEquity - totalBalanceChf, 2);
    this.logger.info(
      `Ledger equity parity: journalEquity ${journalEquity} vs totalBalanceChf ${totalBalanceChf} (difference ${difference})`,
    );
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
