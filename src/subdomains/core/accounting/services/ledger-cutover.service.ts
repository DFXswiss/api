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
import { LiquidityManagementOrder } from 'src/subdomains/core/liquidity-management/entities/liquidity-management-order.entity';
import { LiquidityManagementOrderStatus } from 'src/subdomains/core/liquidity-management/enums';
import { TradingOrder } from 'src/subdomains/core/trading/entities/trading-order.entity';
import { TradingOrderStatus } from 'src/subdomains/core/trading/enums';
import {
  LiquidityOrder,
  LiquidityOrderContext,
  LiquidityOrderType,
} from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { FinanceLog, ManualLogPosition } from 'src/subdomains/supporting/log/dto/log.dto';
import { Log } from 'src/subdomains/supporting/log/log.entity';
import { LogService } from 'src/subdomains/supporting/log/log.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { BankTx, BankTxIndicator, BankTxType } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxRepeat } from 'src/subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.entity';
import { BankTxReturn } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.entity';
import { CryptoInput, CryptoInputSettledStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayoutOrder, PayoutOrderStatus } from 'src/subdomains/supporting/payout/entities/payout-order.entity';
import { Between, In, IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { AccountType, LedgerAccount } from '../entities/ledger-account.entity';
import { LedgerBookingService, LedgerLegInput } from './ledger-booking.service';
import { LedgerBootstrapService } from './ledger-bootstrap.service';
import { LedgerAccountService } from './ledger-account.service';
import { LedgerMarkCache, LedgerMarkService } from './ledger-mark.service';

const CUTOVER_LOG_ID_KEY = 'ledgerCutoverLogId';
// pinned at the very first cutover step (before any opening is booked); makes the snapshot stable across a re-run
// after a partial crash so every per-row opening sourceId (`<logId>:buy_fiat:<id>`, …) stays identical and the
// alreadyBooked UNIQUE backstop catches the collision → no double-counted openings (Major design-accounting, R3-1).
const CUTOVER_SNAPSHOT_LOG_ID_KEY = 'ledgerCutoverSnapshotLogId';
const WATERMARK_KEY_PREFIX = 'ledgerWatermark.';
const SOURCE_TYPE = 'cutover';
const CHF = 'CHF';
const OPEN_ROW_LOOKBACK_DAYS = 90; // only targeted liabilities from rows created > cutover − 90d (§6.1)
// §6.1: unattributed bank_tx credits the LogJob carries as a liability and the forward consumer routes to
// LIABILITY/unattributed (bank-tx.consumer.ts GSHEET/PENDING CRDT). NULL-type credits fall in here too (default-unmapped).
const UNATTRIBUTED_TYPES = [BankTxType.GSHEET, BankTxType.PENDING, BankTxType.UNKNOWN];

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
    @InjectRepository(Bank) private readonly bankRepo: Repository<Bank>,
    // read-only: open the targeted BANK_TX_RETURN/REPEAT liabilities (chargebackBankTx IS NULL) per §6.1 (Major
    // design-accounting) — the cutover anchor a post-cutover chargeback (§4.2 BANK_TX_*_CHARGEBACK) clears against
    @InjectRepository(BankTxReturn) private readonly bankTxReturnRepo: Repository<BankTxReturn>,
    @InjectRepository(BankTxRepeat) private readonly bankTxRepeatRepo: Repository<BankTxRepeat>,
    @InjectRepository(CryptoInput) private readonly cryptoInputRepo: Repository<CryptoInput>,
    @InjectRepository(ExchangeTx) private readonly exchangeTxRepo: Repository<ExchangeTx>,
    @InjectRepository(PayoutOrder) private readonly payoutOrderRepo: Repository<PayoutOrder>,
    @InjectRepository(LiquidityManagementOrder)
    private readonly liquidityManagementOrderRepo: Repository<LiquidityManagementOrder>,
    @InjectRepository(TradingOrder) private readonly tradingOrderRepo: Repository<TradingOrder>,
    @InjectRepository(LiquidityOrder) private readonly liquidityOrderRepo: Repository<LiquidityOrder>,
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

    // (2) snapshot logId = newest valid FinancialDataLog ≤ Stichtag (now), PINNED on first run so a crash-then-retry
    // reuses the exact same logId (stable opening sourceIds → idempotent re-run, Major design-accounting R3-1)
    const snapshot = await this.pinnedSnapshot();
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

  // §6.3 + Major design-accounting (R3-1): the snapshot logId is PINNED at the first cutover step and reused on every
  // re-run. WHY: the per-row openings commit each in their own dataSource.transaction (§6.2), NOT in one atomic
  // cutover tx; if the cutover crashes after some openings but before the ledgerCutoverLogId flag is set, the flag
  // stays unset and the cron retries. Without a pin, the retry re-selects `maxObj(valid,'created')` over a window that
  // has drifted (now moved on, ~2284 new FinancialDataLogs/day) → a DIFFERENT logId → DIFFERENT opening sourceIds
  // (`<logId>:buy_fiat:<id>`) → alreadyBooked finds no collision → ALL openings are booked AGAIN (Equity ~2×,
  // Acceptance #3 broken). Pinning the logId once keeps the snapshot stable so the re-run hits the UNIQUE/alreadyBooked
  // backstop on every already-booked opening and re-books nothing.
  private async pinnedSnapshot(): Promise<Log | undefined> {
    const pinned = await this.settingService.get(CUTOVER_SNAPSHOT_LOG_ID_KEY);
    if (pinned != null) {
      // a previous (partial) run already chose the snapshot — reuse the exact logId so all sourceIds stay stable
      const log = await this.logService.getLog(+pinned);
      if (!log) throw new Error(`pinned cutover snapshot FinancialDataLog #${pinned} no longer exists`);
      return log;
    }

    const snapshot = await this.selectSnapshot();
    if (!snapshot) return undefined;

    // pin BEFORE booking any opening (set-only-if-unset: re-read guards a concurrent pin, the chosen logId wins and
    // the runner that read it first proceeds; the openings' UNIQUE backstop keeps a parallel run idempotent anyway).
    if ((await this.settingService.get(CUTOVER_SNAPSHOT_LOG_ID_KEY)) == null) {
      await this.settingService.set(CUTOVER_SNAPSHOT_LOG_ID_KEY, `${snapshot.id}`);
    }
    const repinned = await this.settingService.get(CUTOVER_SNAPSHOT_LOG_ID_KEY);
    return repinned != null && +repinned !== snapshot.id ? this.logService.getLog(+repinned) : snapshot;
  }

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
    // §6.1 (Major design-accounting): the BANK_TX_RETURN/REPEAT + unattributed liabilities. A pre-cutover open
    // return/repeat whose chargeback settles post-cutover (§4.2 BANK_TX_*_CHARGEBACK) finds its opening-CHF anchor
    // here; without it the chargeback's −Σ(other legs) fallback leaves the liability phantom-negative (never on 0).
    await this.openBankTxReturn(snapshot, snapshotDate, lookback, marks, equity);
    await this.openBankTxRepeat(snapshot, snapshotDate, lookback, marks, equity);
    await this.openUnattributed(snapshot, snapshotDate, lookback, marks, equity);
  }

  // buyFiat-received: open rows with outputAmount NULL → CHF = amountInChf (Minor R3-6); per-row seq0-marker (R4-2)
  private async openBuyFiatReceived(snapshot: Log, date: Date, lookback: Date, equity: LedgerAccount): Promise<void> {
    const rows = await this.buyFiatRepo.find({
      where: { isComplete: false, outputAmount: IsNull(), created: Between(lookback, date) },
    });
    const liability = await this.liability('buyFiat-received');

    for (const row of rows) {
      if (row.amountInChf == null) continue;
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
      where: { isComplete: false, created: Between(lookback, date) },
      relations: { outputAsset: true },
    });
    const liability = await this.liability('buyFiat-owed');

    for (const row of rows) {
      if (row.outputAmount == null) continue;

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
      where: { isComplete: false, outputAmount: IsNull(), created: Between(lookback, date) },
    });
    const liability = await this.liability('buyCrypto-received');

    for (const row of rows) {
      if (row.amountInChf == null) continue;
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
      where: { isComplete: false, created: Between(lookback, date) },
      relations: { outputAsset: true },
    });
    const liability = await this.liability('buyCrypto-owed');

    for (const row of rows) {
      if (row.outputAmount == null) continue;

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

  // --- BANK_TX_RETURN / BANK_TX_REPEAT / UNATTRIBUTED OPENINGS (§6.1, Major design-accounting) --- //

  // §6.1: open BANK_TX_RETURN liabilities (`chargebackBankTx IS NULL` → still open) per source-row, CHF-valued =
  // pendingInputAmount(bankAsset) × mark(bankAsset ≤ snapshot) so it matches the forward consumer's `EUR-mark × amount`
  // credit (bank-tx.consumer.ts liabilityCreditLegs) and the post-cutover chargeback's opening-CHF anchor (§4.2 B-15).
  // Per-row sourceId marker `<logId>:bank_tx-return:<bankTxId>` lets the chargeback consumer find this opening leg
  // (analog the owed marker) → bankTx-return closes cent-exact to 0 instead of staying phantom-negative.
  private async openBankTxReturn(
    snapshot: Log,
    date: Date,
    lookback: Date,
    marks: LedgerMarkCache,
    equity: LedgerAccount,
  ): Promise<void> {
    const rows = await this.bankTxReturnRepo.find({
      where: { chargebackBankTx: IsNull(), created: Between(lookback, date) },
      relations: { bankTx: true },
    });
    const liability = await this.liability('bankTx-return');

    for (const row of rows) {
      await this.openOpenLiabilityRow(snapshot, date, marks, equity, liability, 'bank_tx-return', row.bankTx);
    }
  }

  // §6.1: same as openBankTxReturn for BANK_TX_REPEAT (`chargebackBankTx IS NULL`), marker `<logId>:bank_tx-repeat:<id>`
  private async openBankTxRepeat(
    snapshot: Log,
    date: Date,
    lookback: Date,
    marks: LedgerMarkCache,
    equity: LedgerAccount,
  ): Promise<void> {
    const rows = await this.bankTxRepeatRepo.find({
      where: { chargebackBankTx: IsNull(), created: Between(lookback, date) },
      relations: { bankTx: true },
    });
    const liability = await this.liability('bankTx-repeat');

    for (const row of rows) {
      await this.openOpenLiabilityRow(snapshot, date, marks, equity, liability, 'bank_tx-repeat', row.bankTx);
    }
  }

  // one per-row return/repeat opening: Cr LIABILITY/{bucket} / Dr EQUITY at CHF = amount × bankMark (≤ snapshot).
  // CHF bank → mark 1; non-CHF (EUR) → EUR-mark; feedless/no-bank-match → needsMark (mark-to-market values later).
  private async openOpenLiabilityRow(
    snapshot: Log,
    date: Date,
    marks: LedgerMarkCache,
    equity: LedgerAccount,
    liability: LedgerAccount,
    marker: string,
    bankTx: BankTx | undefined,
  ): Promise<void> {
    if (bankTx?.amount == null) return; // no underlying bank_tx amount → nothing to anchor

    const { mark } = await this.bankMark(bankTx, date, marks);
    const amountChf = mark != null ? Util.round(bankTx.amount * mark, 2) : undefined;

    await this.bookReceivedOwedOpening(
      snapshot,
      date,
      `${snapshot.id}:${marker}:${bankTx.id}`,
      `Opening ${marker} from open bank_tx #${bankTx.id}`,
      liability,
      amountChf,
      equity,
      mark == null,
    );
  }

  // §6.1: aggregated LIABILITY/unattributed opening from still-open unattributed bank_tx credits (type NULL/Pending/
  // Unknown/GSheet, CRDT). CHF-valued = Σ(amount × bankMark) so it matches the forward consumer's `EUR-mark × amount`
  // credit (bank-tx.consumer.ts liabilityCreditLegs 'unattributed'). Aggregated (no per-row marker): there is no
  // chargeback-clearing path that resolves a single unattributed row — the balance is carried like the LogJob does.
  private async openUnattributed(
    snapshot: Log,
    date: Date,
    lookback: Date,
    marks: LedgerMarkCache,
    equity: LedgerAccount,
  ): Promise<void> {
    // §6.1: type NULL/Pending/Unknown/GSheet credits → the unattributed bucket (two where-branches for the NULL type)
    const credit = { creditDebitIndicator: BankTxIndicator.CREDIT, created: Between(lookback, date) };
    const rows = [
      ...(await this.bankTxRepo.find({ where: { ...credit, type: In(UNATTRIBUTED_TYPES) } })),
      ...(await this.bankTxRepo.find({ where: { ...credit, type: IsNull() } })),
    ];

    let amountChf = 0;
    let needsMark = false;
    for (const row of rows) {
      if (row.amount == null) continue;
      const { mark } = await this.bankMark(row, date, marks);
      if (mark == null) {
        needsMark = true; // a feedless/unmatched credit cannot be valued now → mark-to-market values the rest later
        continue;
      }
      amountChf += Util.round(row.amount * mark, 2);
    }

    if (Math.abs(amountChf) <= 1e-8 && !needsMark) return; // no open unattributed credits → no opening

    const liability = await this.liability('unattributed');
    await this.bookReceivedOwedOpening(
      snapshot,
      date,
      `${snapshot.id}:unattributed`,
      `Opening unattributed from open bank_tx credits as of FinancialDataLog #${snapshot.id}`,
      liability,
      // a feedless/unmatched credit leaves the aggregate unvaluable → carry amountChf=undefined (needsMark) so the
      // mark-to-market job values the whole bucket later (§5.1 Stufe 3); never a partial/-0 phantom CHF on the leg.
      needsMark ? undefined : Util.round(amountChf, 2),
      equity,
      needsMark,
    );
  }

  // the bank's currency asset + its CHF mark (≤ snapshot) for a bank_tx (via accountIban → Bank.asset, §4.2/§1.6).
  // CHF bank → mark 1; EUR bank → EUR-mark from the cache; no bank match / feedless → mark undefined (caller needsMark).
  private async bankMark(
    bankTx: BankTx,
    date: Date,
    marks: LedgerMarkCache,
  ): Promise<{ asset?: Asset; mark: number | undefined }> {
    const bank = bankTx.accountIban
      ? await this.bankRepo.findOne({ where: { iban: bankTx.accountIban }, relations: { asset: true } })
      : null;

    if (bank?.currency === CHF || bankTx.currency === CHF) return { asset: bank?.asset, mark: 1 };
    const asset = bank?.asset;
    return { asset, mark: asset?.id != null ? marks.getMarkAt(asset.id, date) : undefined };
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
  // ALL nine consumer sources MUST be initialised here (§6.3 Z.910-917, Blocker R3-1) — a missing watermark would
  // default the consumer to lastProcessedId:0 → WHERE id>0 full-history backfill (Hard Constraint #4 + ASSET
  // double-count vs the openAssets openings, §6.1). The settled-filter per source is exactly the §4.x consumer
  // filter (§6.3 Z.917).
  private async initWatermarks(snapshotDate: Date): Promise<void> {
    const sources: { source: string; maxId: () => Promise<number> }[] = [
      { source: 'bank_tx', maxId: () => this.maxSettledId(this.bankTxRepo, 'bookingDate', snapshotDate) },
      // §4.4 — crypto_input: status ∈ CryptoInputSettledStatus + updated <= snapshot (§6.3 Z.917)
      {
        source: 'crypto_input',
        maxId: () =>
          this.maxSettledId(this.cryptoInputRepo, 'updated', snapshotDate, (qb) =>
            qb.andWhere('e.status IN (:...ciStatus)', { ciStatus: CryptoInputSettledStatus }),
          ),
      },
      // §4.5 — payout_order: status='Complete' + updated <= snapshot (§6.3 Z.917)
      {
        source: 'payout_order',
        maxId: () =>
          this.maxSettledId(this.payoutOrderRepo, 'updated', snapshotDate, (qb) =>
            qb.andWhere('e.status = :poStatus', { poStatus: PayoutOrderStatus.COMPLETE }),
          ),
      },
      // §4.3 — exchange_tx: status='ok' + (externalCreated ?? created) <= snapshot (§6.3 Z.917)
      {
        source: 'exchange_tx',
        maxId: () =>
          this.maxSettledId(this.exchangeTxRepo, 'externalCreated', snapshotDate, (qb) =>
            qb.andWhere('e.status = :etStatus', { etStatus: 'ok' }),
          ),
      },
      { source: 'buy_crypto', maxId: () => this.maxSettledId(this.buyCryptoRepo, 'updated', snapshotDate) },
      { source: 'buy_fiat', maxId: () => this.maxSettledId(this.buyFiatRepo, 'updated', snapshotDate) },
      // §4.8 — liquidity_management_order: status='Complete' + updated <= snapshot
      {
        source: 'liquidity_management_order',
        maxId: () =>
          this.maxSettledId(this.liquidityManagementOrderRepo, 'updated', snapshotDate, (qb) =>
            qb.andWhere('e.status = :lmStatus', { lmStatus: LiquidityManagementOrderStatus.COMPLETE }),
          ),
      },
      // §4.9 — trading_order: status='Complete' AND txId IS NOT NULL + updated <= snapshot
      {
        source: 'trading_order',
        maxId: () =>
          this.maxSettledId(this.tradingOrderRepo, 'updated', snapshotDate, (qb) =>
            qb
              .andWhere('e.status = :toStatus', { toStatus: TradingOrderStatus.COMPLETE })
              .andWhere('e.txId IS NOT NULL'),
          ),
      },
      // §4.8a — liquidity_order: txId IS NOT NULL AND context IN (...) AND type IN ('Purchase','Sell') + updated <= snapshot
      {
        source: 'liquidity_order',
        maxId: () =>
          this.maxSettledId(this.liquidityOrderRepo, 'updated', snapshotDate, (qb) =>
            qb
              .andWhere('e.txId IS NOT NULL')
              .andWhere('e.context IN (:...loContexts)', {
                loContexts: [
                  LiquidityOrderContext.LIQUIDITY_MANAGEMENT,
                  LiquidityOrderContext.BUY_CRYPTO,
                  LiquidityOrderContext.TRADING,
                ],
              })
              .andWhere('e.type IN (:...loTypes)', {
                loTypes: [LiquidityOrderType.PURCHASE, LiquidityOrderType.SELL],
              }),
          ),
      },
    ];

    for (const { source, maxId } of sources) {
      await this.setWatermark(source, await maxId(), snapshotDate);
    }
  }

  // MAX(id) of rows whose settlement date ≤ snapshot AND that match the per-consumer settled filter (§4.x / §6.3
  // Z.917). The optional `filter` appends the consumer-specific settled-status predicates (e.g. status='Complete',
  // txId IS NOT NULL) so the watermark = "highest pre-cutover row whose settlement the opening already covers".
  private async maxSettledId<T>(
    repo: Repository<T>,
    dateColumn: string,
    snapshotDate: Date,
    filter?: (qb: SelectQueryBuilder<T>) => SelectQueryBuilder<T>,
  ): Promise<number> {
    let qb = repo
      .createQueryBuilder('e')
      .select('MAX(e.id)', 'max')
      .where(`COALESCE(e.${dateColumn}, e.created) <= :date`, { date: snapshotDate });

    if (filter) qb = filter(qb); // appends the per-consumer settled-status predicates via .andWhere (all ANDed)

    const { max } = (await qb.getRawOne<{ max: number | null }>()) ?? { max: null };

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
