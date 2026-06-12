import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { ExchangeTx } from 'src/integration/exchange/entities/exchange-tx.entity';
import { FinanceLog, ManualLogPosition } from 'src/subdomains/supporting/log/dto/log.dto';
import { Log } from 'src/subdomains/supporting/log/log.entity';
import { LogService } from 'src/subdomains/supporting/log/log.service';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayoutOrder } from 'src/subdomains/supporting/payout/entities/payout-order.entity';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { AccountType, LedgerAccount } from '../entities/ledger-account.entity';
import { LedgerBookingService, LedgerLegInput } from './ledger-booking.service';
import { LedgerBootstrapService } from './ledger-bootstrap.service';
import { LedgerAccountService } from './ledger-account.service';
import { LedgerMarkCache, LedgerMarkService } from './ledger-mark.service';

const CUTOVER_LOG_ID_KEY = 'ledgerCutoverLogId';
const WATERMARK_KEY_PREFIX = 'ledgerWatermark.';
const SOURCE_TYPE = 'cutover';
const CHF = 'CHF';
const OPEN_ROW_LOOKBACK_DAYS = 90; // only targeted liabilities from rows created > cutover − 90d (§6.1)

@Injectable()
export class LedgerCutoverService {
  private readonly logger = new DfxLogger(LedgerCutoverService);

  constructor(
    private readonly settingService: SettingService,
    private readonly logService: LogService,
    private readonly bootstrapService: LedgerBootstrapService,
    private readonly bookingService: LedgerBookingService,
    private readonly accountService: LedgerAccountService,
    private readonly markService: LedgerMarkService,
    @InjectRepository(BuyFiat) private readonly buyFiatRepo: Repository<BuyFiat>,
    @InjectRepository(BuyCrypto) private readonly buyCryptoRepo: Repository<BuyCrypto>,
    @InjectRepository(BankTx) private readonly bankTxRepo: Repository<BankTx>,
    @InjectRepository(CryptoInput) private readonly cryptoInputRepo: Repository<CryptoInput>,
    @InjectRepository(ExchangeTx) private readonly exchangeTxRepo: Repository<ExchangeTx>,
    @InjectRepository(PayoutOrder) private readonly payoutOrderRepo: Repository<PayoutOrder>,
  ) {}

  /**
   * One-time cutover (§6, Blocker R13). Runs as @DfxCron (Major R2-6 — NOT onModuleInit: an awaited async
   * onModuleInit would block the app boot on every pod/instance and a throw would prevent boot). Process flag
   * is only effective via @DfxCron (dfx-cron.service lock layer). The whole opening sequence is failure-isolated:
   * a crash never breaks the boot/cron run, leaves `ledgerCutoverLogId` unset → all consumers no-op (§4 gate).
   * The cron no-ops immediately once the flag is set, so it effectively runs once and is otherwise idle.
   */
  @DfxCron(CronExpression.EVERY_5_MINUTES, { process: Process.LEDGER_CUTOVER })
  async run(): Promise<void> {
    if ((await this.settingService.get(CUTOVER_LOG_ID_KEY)) != null) return; // primary guard: already cut over → no-op

    try {
      await this.cutover();
    } catch (e) {
      // failure-isolation (§6.3): caught + logged, never hard-aborts; flag stays unset → consumers no-op, retry next run
      this.logger.error('Ledger cutover failed', e);
    }
  }

  // gelockter Cutover-Run, fixed order (§6.3 Blocker R1-6/R3-1)
  private async cutover(): Promise<void> {
    // (1) CoA bootstrap (idempotent, findOrCreate per account)
    await this.bootstrapService.bootstrap();

    // (2) snapshot logId = newest valid FinancialDataLog ≤ Stichtag (now)
    const snapshot = await this.selectSnapshot();
    if (!snapshot) throw new Error('No valid FinancialDataLog snapshot available for cutover');

    const finance = this.parseFinance(snapshot.message);
    if (!finance) throw new Error(`FinancialDataLog #${snapshot.id} message is not parseable`);

    const snapshotDate = snapshot.created;
    const marks = await this.markService.preload(Util.daysBefore(2, snapshotDate), snapshotDate);
    const equity = await this.equityAccount();

    // (3) ASSET openings → LIABILITY openings → Manual openings (TRANSIT stays 0)
    await this.openAssets(finance, snapshot, snapshotDate, equity);
    await this.openLiabilities(snapshot, snapshotDate, marks, equity);
    await this.openManualDebt(finance, snapshot, snapshotDate, equity);

    // (4) initialise consumer watermarks atomically — only rows settled at/before the snapshot (Blocker R3-1)
    await this.initWatermarks(snapshotDate);

    // (5) LAST: set the "ledger ready" marker the §4 gate reads (auditable: value = used logId)
    await this.settingService.set(CUTOVER_LOG_ID_KEY, `${snapshot.id}`);
    this.logger.info(`Ledger cutover complete from FinancialDataLog #${snapshot.id}`);
  }

  // --- SNAPSHOT --- //

  // §6.3: newest valid=true FinancialDataLog ≤ Stichtag. Bounded read (last 2 days) then pick latest ≤ now.
  private async selectSnapshot(): Promise<Log | undefined> {
    const now = new Date();
    const candidates = await this.logService.getFinancialLogs(Util.daysBefore(2, now));
    const valid = candidates.filter((l) => l.created.getTime() <= now.getTime());

    return valid.length ? Util.maxObj(valid, 'created') : undefined;
  }

  private parseFinance(message: string): FinanceLog | undefined {
    try {
      return JSON.parse(message) as FinanceLog;
    } catch {
      return undefined;
    }
  }

  // --- ASSET OPENINGS (§6.1) --- //

  // ASSET opening from persisted balances (never plusBalance.total — pending phantoms). Feedless/placeholder → 0.
  private async openAssets(
    finance: FinanceLog,
    snapshot: Log,
    snapshotDate: Date,
    equity: LedgerAccount,
  ): Promise<void> {
    let seq = 0;
    for (const [assetIdKey, assetLog] of Object.entries(finance.assets)) {
      const assetId = +assetIdKey;
      const account = await this.accountService.findByAssetId(assetId);
      if (!account) continue; // asset not in the CoA (CUSTOM/PRESALE/feedless-without-row) → no opening

      const native = this.assetOpeningAmount(assetLog);
      if (Math.abs(native) <= 1e-8) {
        seq++;
        continue; // feedless/placeholder/zero → opening 0, no leg
      }

      const priceChf = Number.isFinite(assetLog.priceChf) ? assetLog.priceChf : undefined;
      const amountChf = priceChf != null ? Util.round(priceChf * native, 2) : undefined;

      await this.bookOpening(
        snapshot,
        seq++,
        `${snapshot.id}`,
        `Opening balance from FinancialDataLog #${snapshot.id}`,
        snapshotDate,
        {
          account,
          amount: native,
          priceChf: priceChf ?? null,
          amountChf,
          needsMark: amountChf == null, // dauerhaft feedlos → nativ, mark-to-market bewertet nach (§5.1 Stufe 3)
        },
        equity,
      );
    }
  }

  // §6.1: liquidityBalance.total + paymentDepositBalance + manualLiqPosition + custom.total — never plusBalance.total
  private assetOpeningAmount(assetLog: FinanceLog['assets'][string]): number {
    const liquidity = assetLog.plusBalance?.liquidity;
    const liquidityBalance = liquidity?.liquidityBalance?.total ?? 0;

    // placeholder feed (amount=1.0) → opening 0, never reconcile (§7.1)
    if (liquidityBalance === 1.0) return 0;

    return (
      liquidityBalance +
      (liquidity?.paymentDepositBalance ?? 0) +
      (liquidity?.manualLiqPosition ?? 0) +
      (assetLog.plusBalance?.custom?.total ?? 0)
    );
  }

  // --- LIABILITY OPENINGS (§6.1, per-row for received/owed) --- //

  private async openLiabilities(
    snapshot: Log,
    snapshotDate: Date,
    marks: LedgerMarkCache,
    equity: LedgerAccount,
  ): Promise<void> {
    const lookback = Util.daysBefore(OPEN_ROW_LOOKBACK_DAYS, snapshotDate);

    await this.openBuyFiatReceived(snapshot, snapshotDate, lookback, equity);
    await this.openBuyFiatOwed(snapshot, snapshotDate, lookback, marks, equity);
    await this.openBuyCryptoReceived(snapshot, snapshotDate, lookback, equity);
    await this.openBuyCryptoOwed(snapshot, snapshotDate, lookback, marks, equity);
  }

  // buyFiat-received: open rows with outputAmount NULL → CHF = amountInChf (Minor R3-6); per-row seq0-marker (R4-2)
  private async openBuyFiatReceived(snapshot: Log, date: Date, lookback: Date, equity: LedgerAccount): Promise<void> {
    const rows = await this.buyFiatRepo.find({
      where: { isComplete: false, outputAmount: IsNull(), created: LessThanOrEqual(date) },
    });
    const liability = await this.liability('buyFiat-received');

    for (const row of rows) {
      if (row.created.getTime() < lookback.getTime() || row.amountInChf == null) continue;
      await this.bookReceivedOwedOpening(
        snapshot,
        date,
        `${snapshot.id}:buy_fiat:${row.id}`,
        `Opening buyFiat-received from open buy_fiat #${row.id}`,
        liability,
        row.amountInChf,
        equity,
      );
    }
  }

  // buyFiat-owed: open rows with outputAmount NOT NULL → CHF = outputAmount × mark(outputAsset-Fiat ≤ snapshot) (R6-1)
  private async openBuyFiatOwed(
    snapshot: Log,
    date: Date,
    lookback: Date,
    marks: LedgerMarkCache,
    equity: LedgerAccount,
  ): Promise<void> {
    const rows = await this.buyFiatRepo.find({
      where: { isComplete: false, created: LessThanOrEqual(date) },
      relations: { outputAsset: true },
    });
    const liability = await this.liability('buyFiat-owed');

    for (const row of rows) {
      if (row.outputAmount == null || row.created.getTime() < lookback.getTime()) continue;

      // outputAsset is a Fiat; CHF-output → mark 1, foreign-currency output → fiat-mark ≤ snapshot
      const fiatMark = row.outputAsset?.name === CHF ? 1 : this.fiatMark(row.outputAsset?.id, date, marks);
      if (fiatMark == null) continue; // no mark → cannot value the CHF-denominated liability; leave to forward path
      const amountChf = Util.round(row.outputAmount * fiatMark, 2);

      await this.bookReceivedOwedOpening(
        snapshot,
        date,
        `${snapshot.id}:buy_fiat-owed:${row.id}`,
        `Opening buyFiat-owed from open buy_fiat #${row.id}`,
        liability,
        amountChf,
        equity,
      );
    }
  }

  // buyCrypto-received: open rows with outputAmount NULL → CHF = amountInChf (Minor R2-7); per-row seq0-marker (R4-2)
  private async openBuyCryptoReceived(snapshot: Log, date: Date, lookback: Date, equity: LedgerAccount): Promise<void> {
    const rows = await this.buyCryptoRepo.find({
      where: { isComplete: false, outputAmount: IsNull(), created: LessThanOrEqual(date) },
    });
    const liability = await this.liability('buyCrypto-received');

    for (const row of rows) {
      if (row.created.getTime() < lookback.getTime() || row.amountInChf == null) continue;
      await this.bookReceivedOwedOpening(
        snapshot,
        date,
        `${snapshot.id}:buy_crypto:${row.id}`,
        `Opening buyCrypto-received from open buy_crypto #${row.id}`,
        liability,
        row.amountInChf,
        equity,
      );
    }
  }

  // buyCrypto-owed: open rows with outputAmount NOT NULL → CHF = outputAmount × getMarkAt(outputAsset ≤ snapshot) (R6-1)
  private async openBuyCryptoOwed(
    snapshot: Log,
    date: Date,
    lookback: Date,
    marks: LedgerMarkCache,
    equity: LedgerAccount,
  ): Promise<void> {
    const rows = await this.buyCryptoRepo.find({
      where: { isComplete: false, created: LessThanOrEqual(date) },
      relations: { outputAsset: true },
    });
    const liability = await this.liability('buyCrypto-owed');

    for (const row of rows) {
      if (row.outputAmount == null || row.created.getTime() < lookback.getTime()) continue;

      const mark = row.outputAsset?.id != null ? marks.getMarkAt(row.outputAsset.id, date) : undefined;
      const amountChf = mark != null ? Util.round(row.outputAmount * mark, 2) : undefined;

      await this.bookReceivedOwedOpening(
        snapshot,
        date,
        `${snapshot.id}:buy_crypto-owed:${row.id}`,
        `Opening buyCrypto-owed from open buy_crypto #${row.id}`,
        liability,
        amountChf,
        equity,
        mark == null, // feedless outputAsset → needsMark, mark-to-market values it later (§5.1 Stufe 3)
      );
    }
  }

  // --- MANUAL OPENING (§6.1 D15 C.f) --- //

  // Only the debt side as a separate manual-opening leg: Dr EQUITY/opening-balance / Cr LIABILITY/manual-debt.
  // The liq side is already part of the ASSET-opening sum (manualLiqPosition) → never double-counted (Minor R6-5).
  private async openManualDebt(
    finance: FinanceLog,
    snapshot: Log,
    snapshotDate: Date,
    equity: LedgerAccount,
  ): Promise<void> {
    const debts = await this.settingService.getObj<ManualLogPosition[]>('balanceLogDebtPositions', []);
    if (!debts?.length) return;

    const manualDebt = await this.liability('manual-debt');
    let seq = 0;
    for (const position of debts) {
      if (!position?.value) {
        seq++;
        continue;
      }

      const rawPrice = finance.assets[position.assetId]?.priceChf;
      const priceChf = Number.isFinite(rawPrice) ? rawPrice : undefined;
      const amountChf = priceChf != null ? Util.round(priceChf * position.value, 2) : undefined;

      await this.bookOpening(
        snapshot,
        seq++,
        `${snapshot.id}:manual-debt:${position.assetId}`,
        `Opening manual-debt for asset #${position.assetId} from FinancialDataLog #${snapshot.id}`,
        snapshotDate,
        {
          account: manualDebt,
          amount: -(amountChf ?? position.value),
          priceChf: priceChf ?? null,
          amountChf: amountChf != null ? -amountChf : undefined,
          needsMark: amountChf == null,
        },
        equity,
      );
    }
  }

  // --- WATERMARK INIT (§6.3 step 4, Blocker R3-1) --- //

  // sets each ledgerWatermark.<source> to MAX(id) of pre-cutover settled rows + lastReversalScan = snapshotDate,
  // so the forward consumers never re-book a row whose settlement the opening already covers (no double-count).
  private async initWatermarks(snapshotDate: Date): Promise<void> {
    const sources: { source: string; maxId: () => Promise<number> }[] = [
      { source: 'bank_tx', maxId: () => this.maxSettledId(this.bankTxRepo, 'bookingDate', snapshotDate) },
      { source: 'crypto_input', maxId: () => this.maxSettledId(this.cryptoInputRepo, 'updated', snapshotDate) },
      { source: 'payout_order', maxId: () => this.maxSettledId(this.payoutOrderRepo, 'updated', snapshotDate) },
      { source: 'exchange_tx', maxId: () => this.maxSettledId(this.exchangeTxRepo, 'created', snapshotDate) },
      { source: 'buy_crypto', maxId: () => this.maxSettledId(this.buyCryptoRepo, 'updated', snapshotDate) },
      { source: 'buy_fiat', maxId: () => this.maxSettledId(this.buyFiatRepo, 'updated', snapshotDate) },
    ];

    for (const { source, maxId } of sources) {
      await this.setWatermark(source, await maxId(), snapshotDate);
    }
  }

  // MAX(id) of rows whose settlement date ≤ snapshot (the consumer-specific settled filter, §4.x simplified to the
  // settlement-date cutoff — the forward id-watermark only needs the highest pre-cutover-settled id, §6.3 Effekt)
  private async maxSettledId<T>(repo: Repository<T>, dateColumn: string, snapshotDate: Date): Promise<number> {
    const { max } = (await repo
      .createQueryBuilder('e')
      .select('MAX(e.id)', 'max')
      .where(`COALESCE(e.${dateColumn}, e.created) <= :date`, { date: snapshotDate })
      .getRawOne<{ max: number | null }>()) ?? { max: null };

    return max ?? 0;
  }

  private async setWatermark(source: string, lastProcessedId: number, snapshotDate: Date): Promise<void> {
    await this.settingService.set(
      `${WATERMARK_KEY_PREFIX}${source}`,
      JSON.stringify({ lastProcessedId, lastReversalScan: snapshotDate.toISOString() }),
    );
  }

  // --- BOOKING HELPERS --- //

  // a single 2-leg opening tx (account leg + EQUITY counter-leg) → balances by construction in CHF (§6.2)
  private async bookOpening(
    snapshot: Log,
    seq: number,
    sourceId: string,
    description: string,
    bookingDate: Date,
    accountLeg: LedgerLegInput,
    equity: LedgerAccount,
  ): Promise<void> {
    if (await this.alreadyBooked(sourceId, seq)) return; // re-run idempotent (UNIQUE backstop, Setting primary guard)

    const counterChf = accountLeg.amountChf != null ? -accountLeg.amountChf : undefined;
    await this.bookingService.bookTx({
      sourceType: SOURCE_TYPE,
      sourceId,
      seq,
      bookingDate,
      valueDate: bookingDate,
      description,
      legs: [
        accountLeg,
        {
          account: equity,
          amount: counterChf ?? 0,
          priceChf: 1,
          amountChf: counterChf,
          needsMark: accountLeg.needsMark,
        },
      ],
    });
  }

  // per-row received/owed opening (seq=0): Cr LIABILITY/{…} / Dr EQUITY/opening-balance, CHF-valued (§6.3 R4-2/R6-1)
  private async bookReceivedOwedOpening(
    snapshot: Log,
    bookingDate: Date,
    sourceId: string,
    description: string,
    liability: LedgerAccount,
    amountChf: number | undefined,
    equity: LedgerAccount,
    needsMark = false,
  ): Promise<void> {
    await this.bookOpening(
      snapshot,
      0,
      sourceId,
      description,
      bookingDate,
      {
        account: liability,
        amount: -(amountChf ?? 0),
        priceChf: 1,
        amountChf: amountChf != null ? -amountChf : undefined,
        needsMark,
      },
      equity,
    );
  }

  private async alreadyBooked(sourceId: string, seq: number): Promise<boolean> {
    return (await this.bookingService.nextSeq(SOURCE_TYPE, sourceId)) > seq;
  }

  // foreign-fiat mark from the asset mark cache (priceChf of the fiat asset ≤ snapshot)
  private fiatMark(assetId: number | undefined, date: Date, marks: LedgerMarkCache): number | undefined {
    return assetId != null ? marks.getMarkAt(assetId, date) : undefined;
  }

  private liability(qualifier: string): Promise<LedgerAccount> {
    return this.accountService.findOrCreate(`LIABILITY/${qualifier}`, AccountType.LIABILITY, CHF);
  }

  private equityAccount(): Promise<LedgerAccount> {
    return this.accountService.findOrCreate('EQUITY/opening-balance', AccountType.EQUITY, CHF);
  }
}
