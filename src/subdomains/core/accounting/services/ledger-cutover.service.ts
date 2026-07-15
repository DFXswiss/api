import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { ExchangeTx } from 'src/integration/exchange/entities/exchange-tx.entity';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { LiquidityManagementOrder } from 'src/subdomains/core/liquidity-management/entities/liquidity-management-order.entity';
import { LiquidityManagementOrderStatus } from 'src/subdomains/core/liquidity-management/enums';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { TradingOrder } from 'src/subdomains/core/trading/entities/trading-order.entity';
import { TradingOrderStatus } from 'src/subdomains/core/trading/enums';
import { BankTx, BankTxIndicator, BankTxType } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxRepeat } from 'src/subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.entity';
import { BankTxReturn } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.entity';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import {
  LiquidityOrder,
  LiquidityOrderContext,
  LiquidityOrderType,
} from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { FinanceLog, ManualLogPosition } from 'src/subdomains/supporting/log/dto/log.dto';
import { Log } from 'src/subdomains/supporting/log/log.entity';
import { LogService } from 'src/subdomains/supporting/log/log.service';
import { CryptoInput, CryptoInputSettledStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayoutOrder, PayoutOrderStatus } from 'src/subdomains/supporting/payout/entities/payout-order.entity';
import { Between, In, IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { AccountType, LedgerAccount } from '../entities/ledger-account.entity';
import { LedgerAccountService } from './ledger-account.service';
import { LedgerBookingService, LedgerLegInput } from './ledger-booking.service';
import { LedgerBootstrapService } from './ledger-bootstrap.service';
import { LedgerMarkCache, LedgerMarkService } from './ledger-mark.service';
import {
  getCutoverBoundary,
  getCutoverUnpricedIdsRaw,
  isCoveredByCutoverOpening,
  setCutoverBoundary,
  setCutoverUnpricedIds,
} from './consumers/ledger-watermark.helper';

const CUTOVER_LOG_ID_KEY = 'ledgerCutoverLogId';
// pinned at the very first cutover step (before any opening is booked); makes the snapshot stable across a re-run
// after a partial crash so every per-row opening sourceId (`<logId>:buy_fiat:<id>`, …) stays identical and the
// alreadyBooked UNIQUE backstop catches the collision → no double-counted openings (Major design-accounting, R3-1).
const CUTOVER_SNAPSHOT_LOG_ID_KEY = 'ledgerCutoverSnapshotLogId';
// the pinned snapshot's created-date, exported so a forward consumer can classify a row as pre-cutover-settled
// (its value already in the aggregate opening, §6.1) vs open/post-cutover (§6.3). The buy_crypto Card gate reads it:
// a completed Card row whose outputDate ≤ this date was already captured by openAssets → its seq0/seq1 must NOT be
// (re-)booked. Stable across re-runs because snapshotDate derives from the pinned snapshot (Major design-accounting R3-1).
const CUTOVER_SNAPSHOT_DATE_KEY = 'ledgerCutoverSnapshotDate';
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

    await this.cutover();
  }

  // locked cutover run, fixed order (§6.3 Blocker R1-6/R3-1)
  private async cutover(): Promise<void> {
    // (1) CoA bootstrap (idempotent, findOrCreate per account)
    await this.bootstrapService.bootstrap();

    // (2) snapshot logId = newest valid FinancialDataLog ≤ cutoff date (now), PINNED on first run so a crash-then-retry
    // reuses the exact same logId (stable opening sourceIds → idempotent re-run, Major design-accounting R3-1)
    const snapshot = await this.pinnedSnapshot();
    if (!snapshot) throw new Error('No valid FinancialDataLog snapshot available for cutover');

    const finance = this.parseFinance(snapshot.message);
    if (!finance) throw new Error(`FinancialDataLog #${snapshot.id} message is not parseable`);

    const snapshotDate = snapshot.created;

    // (3) pin consumer watermarks + cutover boundaries (set-only-if-unset) BEFORE any opening — only rows settled
    // at/before the snapshot (Blocker R3-1). Pinned up front so a fail-loud opening below (missing mark → throw, the
    // ready flag stays unset, the cron retries hours later) can never trigger a recompute of the `updated`-keyed
    // settled predicates against a drifted DB (see initWatermarks).
    await this.initWatermarks(snapshotDate);

    const marks = await this.markService.preload(Util.daysBefore(2, snapshotDate), snapshotDate);
    const equity = await this.equityAccount();

    // (4) ASSET openings → LIABILITY openings → Manual openings (TRANSIT stays 0)
    await this.openAssets(finance, snapshot, snapshotDate, equity);
    await this.openLiabilities(snapshot, snapshotDate, marks, equity);
    await this.openManualDebt(finance, snapshot, snapshotDate, equity);

    // export the pinned snapshot date BEFORE the ready-marker, so any consumer that sees the cutover as done can
    // already classify a pre-cutover-settled row (covered by the aggregate opening). NOT the watermark's
    // lastReversalScan — that drifts forward as the content-change scan advances, so it is not a stable snapshot date.
    await this.settingService.set(CUTOVER_SNAPSHOT_DATE_KEY, snapshotDate.toISOString());

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
      if (!log) throw new Error(`Pinned cutover snapshot FinancialDataLog #${pinned} no longer exists`);
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

  // §6.3: newest valid=true FinancialDataLog ≤ cutoff date. Bounded read (last 2 days) then pick latest ≤ now.
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
    for (const [assetIdKey, assetLog] of Object.entries(finance.assets)) {
      const assetId = +assetIdKey;
      const account = await this.accountService.findByAssetId(assetId);
      if (!account) continue; // asset not in the CoA (CUSTOM/PRESALE/feedless-without-row) → no opening

      const native = this.assetOpeningAmount(assetLog);
      if (Math.abs(native) <= 1e-8) continue; // feedless/placeholder/zero → opening 0, no leg

      const priceChf = Number.isFinite(assetLog.priceChf) ? assetLog.priceChf : undefined;
      const amountChf = priceChf != null ? Util.round(priceChf * native, 2) : undefined;

      // Major B2: key each ASSET opening on its OWN sourceId `<logId>:asset:<assetId>` at seq 0 (the same per-row-marker
      // pattern as the received/owed/manual-debt openings), NOT one running seq over a single `<logId>` sourceId. A
      // running seq is unstable across a fail-loud retry: an asset skipped on the first run (no CoA account) that gets
      // bootstrapped in between shifts every subsequent seq → alreadyBooked (nextSeq > seq) then evaluates the WRONG
      // seq and either re-books an already-booked asset (double) or skips a not-yet-booked one (loss). Keying each asset
      // independently makes alreadyBooked exact per asset → a retry books exactly the missing assets, no seq drift.
      await this.bookOpening(
        0,
        `${snapshot.id}:asset:${assetId}`,
        `Opening balance for asset #${assetId} from FinancialDataLog #${snapshot.id}`,
        snapshotDate,
        {
          account,
          amount: native,
          priceChf: priceChf ?? null,
          amountChf,
          needsMark: amountChf == null, // permanently feedless → native, mark-to-market revalues later (§5.1 stage 3)
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
    // load every bank keyed by IBAN ONCE (§6.1) — openBankTxReturn/Repeat/Unattributed value each row's bank leg
    // against this map instead of a per-row bankRepo.findOne (N+1)
    const bankByIban = await this.bankByIban();

    // F2: openBuyFiat/CryptoReceived+Owed return the ids of open rows they could NOT value into a per-row opening
    // (amountInChf NULL → no CHF anchor). Pin them per source (set-only-if-unset) so the forward consumer skips+advances
    // (with an alarm) instead of wedging, and the Card seq0 does not double-book the gross once the row is priced.
    const unpricedBuyFiat = [
      ...(await this.openBuyFiatReceived(snapshot, snapshotDate, lookback, equity)),
      ...(await this.openBuyFiatOwed(snapshot, snapshotDate, lookback, marks, equity)),
    ];
    await this.pinUnpricedIds('buy_fiat', unpricedBuyFiat);

    const unpricedBuyCrypto = await this.openBuyCryptoReceived(snapshot, snapshotDate, lookback, equity);
    await this.openBuyCryptoOwed(snapshot, snapshotDate, lookback, marks, equity);
    await this.pinUnpricedIds('buy_crypto', unpricedBuyCrypto);
    // §6.1 (Major design-accounting): the BANK_TX_RETURN/REPEAT + unattributed liabilities. A pre-cutover open
    // return/repeat whose chargeback settles post-cutover (§4.2 BANK_TX_*_CHARGEBACK) finds its opening-CHF anchor
    // here; without it the chargeback's −Σ(other legs) fallback leaves the liability phantom-negative (never on 0).
    await this.openBankTxReturn(snapshot, snapshotDate, lookback, marks, equity, bankByIban);
    await this.openBankTxRepeat(snapshot, snapshotDate, lookback, marks, equity, bankByIban);
    await this.openUnattributed(snapshot, snapshotDate, lookback, marks, equity, bankByIban);
  }

  // buyFiat-received: open rows with outputAmount NULL → CHF = amountInChf (Minor R3-6); per-row seq0-marker (R4-2).
  // Returns the ids of rows with a NULL amountInChf (no CHF anchor) so the caller pins them as unpriced-at-cutover (F2).
  // G-a exclusivity (Major): the per-row received/paymentLink opening is mutually exclusive with the forward
  // crypto_input seq0. A row whose funding crypto_input is NOT covered by the pinned cutover opening
  // (isCoveredByCutoverOpening=false, keyed on the immutable at-snapshot crypto_input boundary — NOT the mutable live
  // status) is skipped here — its forward seq0 is the SINGLE received/paymentLink opener; opening it per-row too would
  // double-credit the bucket (permanent phantom, no alarm — the cutover and crypto_input sourceId namespaces are
  // disjoint, so no UNIQUE backstop catches it). A covered input keeps the per-row opening (its seq0 is suppressed as
  // covered-by-cutover, so the per-row opening is then the sole opener). Card-/bank-funded rows have cryptoInput=null → unchanged.
  private async openBuyFiatReceived(
    snapshot: Log,
    date: Date,
    lookback: Date,
    equity: LedgerAccount,
  ): Promise<number[]> {
    const rows = await this.buyFiatRepo.find({
      where: { isComplete: false, outputAmount: IsNull(), created: Between(lookback, date) },
      // F1: load paymentLinkPayment to route a paymentLink-funded row to its OWN paymentLink opening instead of
      // buyFiat-received — the forward bookPaymentLink path clears LIABILITY/paymentLink and would NEVER consume a
      // buyFiat-received/-owed opening (permanent content-scan wedge), and its opening would land in the wrong bucket.
      // cryptoInput.id is read below (G-a) to check coverage against the pinned at-snapshot cutover boundary
      // (isCoveredByCutoverOpening) — an input NOT covered has its forward seq0 as the sole opener, so the per-row
      // opening is skipped.
      relations: { cryptoInput: { paymentLinkPayment: true } },
    });
    const received = await this.liability('buyFiat-received');
    const paymentLink = await this.liability('paymentLink');
    const unpriced: number[] = [];

    for (const row of rows) {
      if (row.amountInChf == null) {
        unpriced.push(row.id); // F2: no CHF anchor → pin; forward SKIPs+advances (alarm), value stays in the aggregate
        continue;
      }
      // G-a: the per-row opening must be EXACTLY complementary to the forward crypto_input seq0 suppression — both key on
      // the SAME pinned at-snapshot boundary (isCoveredByCutoverOpening), NEVER on the mutable live status. A settlement
      // inside the fail-loud retry window would otherwise let BOTH the forward seq0 (live-settled + not covered) and this
      // per-row opening credit received → a permanent double-credit. Open here IFF the input is covered (its value is in
      // the aggregate opening and its seq0 is suppressed); otherwise the forward seq0 is the single opener.
      if (
        row.cryptoInput &&
        !(await isCoveredByCutoverOpening(this.settingService, 'crypto_input', row.cryptoInput.id))
      )
        continue;
      await this.openBuyFiatRow(snapshot, date, row, received, paymentLink, equity);
    }

    return unpriced;
  }

  // buyFiat-owed: open rows with outputAmount NOT NULL → CHF = outputAmount × mark(outputAsset-Fiat ≤ snapshot) (R6-1).
  // Returns the ids of paymentLink rows with a NULL amountInChf (no paymentLink anchor) so the caller pins them (F2).
  private async openBuyFiatOwed(
    snapshot: Log,
    date: Date,
    lookback: Date,
    marks: LedgerMarkCache,
    equity: LedgerAccount,
  ): Promise<number[]> {
    const rows = await this.buyFiatRepo.find({
      where: { isComplete: false, created: Between(lookback, date) },
      // F1: load paymentLinkPayment to detect a paymentLink row (its opening goes to LIABILITY/paymentLink, not -owed).
      // cryptoInput.id is read below (G-a) to check coverage against the pinned cutover boundary (isCoveredByCutoverOpening).
      relations: { outputAsset: true, cryptoInput: { paymentLinkPayment: true } },
    });
    const owed = await this.liability('buyFiat-owed');
    const paymentLink = await this.liability('paymentLink');
    const unpriced: number[] = [];

    for (const row of rows) {
      if (row.outputAmount == null) continue;

      // G-a: the per-row opening (paymentLink or owed) must be EXACTLY complementary to the forward crypto_input seq0
      // suppression — both key on the SAME pinned at-snapshot boundary (isCoveredByCutoverOpening), NEVER on the mutable
      // live status. A settlement inside the fail-loud retry window would otherwise let BOTH the forward seq0
      // (live-settled + not covered) and this per-row opening credit the bucket → a permanent double-credit. Open here
      // IFF the input is covered (its value is in the aggregate opening and its seq0 is suppressed); otherwise the
      // forward seq0 is the single opener. Card-/bank-funded rows have cryptoInput=null → the guard does not fire.
      if (
        row.cryptoInput &&
        !(await isCoveredByCutoverOpening(this.settingService, 'crypto_input', row.cryptoInput.id))
      )
        continue;

      // F1: a paymentLink-funded owed-straddling row → book the paymentLink opening at the gross (amountInChf), NOT
      // buyFiat-owed. amountInChf NULL → pin as unpriced (F2), never a paymentLink opening on a missing anchor.
      if (row.cryptoInput?.paymentLinkPayment != null) {
        if (row.amountInChf == null) {
          unpriced.push(row.id);
          continue;
        }
        await this.bookReceivedOwedOpening(
          date,
          `${snapshot.id}:buy_fiat-paymentLink:${row.id}`,
          `Opening buyFiat paymentLink from open buy_fiat #${row.id}`,
          paymentLink,
          row.amountInChf,
          equity,
        );
        continue;
      }

      // outputAsset is a Fiat; CHF-output → mark 1, foreign-currency output → fiat-mark ≤ snapshot
      const fiatMark = row.outputAsset?.name === CHF ? 1 : this.fiatMark(row.outputAsset?.id, date, marks);
      const amountChf = fiatMark != null ? Util.round(row.outputAmount * fiatMark, 2) : undefined;

      // missing fiat-mark → amountChf undefined → bookReceivedOwedOpening throws (m6 fail-loud): the forward path can
      // NEVER supply this opening — buy-fiat bookRegular (§4.7a) skips seq1 for an owed-straddling row and anchors
      // seq2/seq3 on exactly this opening, so a missing opening would gate-block the row in the content-change scan
      // forever. A missing mark must abort the cutover run (already-booked openings are skipped idempotently on the
      // retry once the mark feed is available), never a silent skip.
      await this.bookReceivedOwedOpening(
        date,
        `${snapshot.id}:buy_fiat-owed:${row.id}`,
        `Opening buyFiat-owed from open buy_fiat #${row.id}`,
        owed,
        amountChf,
        equity,
      );
    }

    return unpriced;
  }

  // §4.7b/§6.1 (F1): one open buyFiat received-row opening. A paymentLink-funded row (cryptoInput.paymentLinkPayment)
  // gets a per-row LIABILITY/paymentLink opening `${logId}:buy_fiat-paymentLink:${id}` at the gross (amountInChf) — the
  // forward bookPaymentLink path clears it via fee + venue-spread + transmit. A regular row gets the buyFiat-received
  // opening. Both carry the same amountInChf CHF value; only the target liability bucket + marker differ.
  private async openBuyFiatRow(
    snapshot: Log,
    date: Date,
    row: BuyFiat,
    received: LedgerAccount,
    paymentLink: LedgerAccount,
    equity: LedgerAccount,
  ): Promise<void> {
    const isPaymentLink = row.cryptoInput?.paymentLinkPayment != null;
    await this.bookReceivedOwedOpening(
      date,
      isPaymentLink ? `${snapshot.id}:buy_fiat-paymentLink:${row.id}` : `${snapshot.id}:buy_fiat:${row.id}`,
      isPaymentLink
        ? `Opening buyFiat paymentLink from open buy_fiat #${row.id}`
        : `Opening buyFiat-received from open buy_fiat #${row.id}`,
      isPaymentLink ? paymentLink : received,
      row.amountInChf,
      equity,
    );
  }

  // buyCrypto-received: open rows with outputAmount NULL → CHF = amountInChf (Minor R2-7); per-row seq0-marker (R4-2).
  // §6.1 (Major B1): Card inputs (checkoutTx != null) are INCLUDED, symmetrically to bank/crypto-funded open rows. An
  // open Card row's card-currency GROSS is ALREADY in the aggregate ASSET opening — openAssets books
  // liquidityBalance.total, which carries the Checkout.com collateral feed: a card charge is auto-captured at payment
  // and sits in that feed until the CHECKOUT_LTD settlement. So the ASSET side is covered by the aggregate opening
  // (exactly as a bank balance funds a bank-funded open row) and THIS per-row opening covers the received LIABILITY
  // side; the completion seq1 later closes received against it. The forward Card seq0
  // (buy-crypto.consumer.buildCardInputSeq0) is gated to SKIP when this marker exists — WITHOUT both the per-row
  // opening and the skip, the forward seq0 would re-debit the gross on Checkout/{ccy} a SECOND time (permanent phantom
  // on Checkout/{ccy}, the pre-fix double-count).
  // G-a exclusivity (Major): a crypto-funded open row (cryptoInput != null) whose funding input is NOT covered by the
  // pinned cutover opening (isCoveredByCutoverOpening=false, keyed on the immutable at-snapshot crypto_input boundary —
  // NOT the mutable live status) is EXCLUDED here — its forward crypto_input seq0 is the SOLE
  // buyCrypto-received opener; opening it per-row too would double-credit buyCrypto-received (permanent phantom, no
  // alarm — the cutover and crypto_input sourceId namespaces are disjoint, so no UNIQUE backstop catches it, and
  // isCoveredByCutoverOpening only knows the crypto_input boundary). A covered input keeps the per-row opening (its
  // seq0 is suppressed as covered-by-cutover, so the per-row opening is then the sole opener). Card-/bank-funded rows
  // (cryptoInput=null) are unaffected — Card: buildCardInputSeq0 is skipped by hasCutoverReceivedOpening; bank: its
  // funding bank_tx seq0 is suppressed by the immutable-bookingDate watermark.
  private async openBuyCryptoReceived(
    snapshot: Log,
    date: Date,
    lookback: Date,
    equity: LedgerAccount,
  ): Promise<number[]> {
    const rows = await this.buyCryptoRepo.find({
      where: { isComplete: false, outputAmount: IsNull(), created: Between(lookback, date) },
      // G-a: load cryptoInput to decide the received opener — a crypto-funded row whose input is not covered by the
      // pinned cutover opening (isCoveredByCutoverOpening) is skipped (its forward seq0 opens received); a Card/bank-funded
      // row has cryptoInput=null.
      relations: { cryptoInput: true },
    });
    const liability = await this.liability('buyCrypto-received');
    const unpriced: number[] = [];

    for (const row of rows) {
      if (row.amountInChf == null) {
        // F2: no CHF anchor → pin; the forward buildCardInputSeq0 SKIPs (its gross is in the aggregate opening via the
        // Checkout collateral feed, re-booking would double-count) and the completion scan skips+advances (no wedge).
        unpriced.push(row.id);
        continue;
      }
      // G-a: the per-row opening must be EXACTLY complementary to the forward crypto_input seq0 suppression — both key on
      // the SAME pinned at-snapshot boundary (isCoveredByCutoverOpening), NEVER on the mutable live status. A settlement
      // inside the fail-loud retry window would otherwise let BOTH the forward seq0 (live-settled + not covered) and this
      // per-row opening credit received → a permanent double-credit. Open here IFF the input is covered (its value is in
      // the aggregate opening and its seq0 is suppressed); otherwise the forward seq0 is the single opener.
      if (
        row.cryptoInput &&
        !(await isCoveredByCutoverOpening(this.settingService, 'crypto_input', row.cryptoInput.id))
      )
        continue;
      await this.bookReceivedOwedOpening(
        date,
        `${snapshot.id}:buy_crypto:${row.id}`,
        `Opening buyCrypto-received from open buy_crypto #${row.id}`,
        liability,
        row.amountInChf,
        equity,
      );
    }

    return unpriced;
  }

  // §6.1 F2: pin the open rows the cutover could not value into a per-row opening (amountInChf NULL) — set-only-if-unset
  // (like the boundary/watermark) so a fail-loud retry reuses the run-1 list verbatim and never overwrites it. An empty
  // list is never pinned (isUnpricedAtCutover defaults to false). Called BEFORE the ready flag → the forward consumer
  // sees it as soon as it starts.
  private async pinUnpricedIds(source: string, ids: number[]): Promise<void> {
    if (!ids.length) return; // no unpriced rows → no pin (forward defaults to the normal path)
    if ((await getCutoverUnpricedIdsRaw(this.settingService, source)) != null) return; // already pinned → reuse verbatim
    await setCutoverUnpricedIds(this.settingService, source, ids);
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
      // G-a: load cryptoInput to decide the owed opener — a crypto-funded row whose input is not covered by the pinned
      // cutover opening (isCoveredByCutoverOpening) is skipped (its forward crypto_input seq0 opens received and the
      // completion seq1 closes it; a per-row owed opening here would make that seq1 SKIP via hasCutoverOwedOpening →
      // orphaned received phantom); a Card/bank-funded row has cryptoInput=null.
      relations: { outputAsset: true, cryptoInput: true },
    });
    const liability = await this.liability('buyCrypto-owed');

    for (const row of rows) {
      if (row.outputAmount == null) continue;

      // G-a: the per-row owed opening must be EXACTLY complementary to the forward crypto_input seq0/seq1 handling — key
      // on the SAME pinned at-snapshot boundary (isCoveredByCutoverOpening), NEVER on the mutable live status. In the
      // [snapshot→pin] retry window an `updated` bump (FORWARD_CONFIRMED→COMPLETED) can leave an input NOT covered while
      // its forward seq0 already opens buyCrypto-received; booking a per-row owed opening here would make the forward
      // completion seq1 SKIP via hasCutoverOwedOpening → the received leg never closes (orphaned received phantom, no
      // UNIQUE backstop — the cutover and crypto_input sourceId namespaces are disjoint). Open here IFF the input is
      // covered (its value is in the aggregate opening and its seq0 is suppressed); otherwise the forward seq0/seq1 chain
      // is the sole handler. Card-/bank-funded rows have cryptoInput=null → the guard does not fire.
      if (
        row.cryptoInput &&
        !(await isCoveredByCutoverOpening(this.settingService, 'crypto_input', row.cryptoInput.id))
      )
        continue;

      const mark = row.outputAsset?.id != null ? marks.getMarkAt(row.outputAsset.id, date) : undefined;
      const amountChf = mark != null ? Util.round(row.outputAmount * mark, 2) : undefined;

      // feedless outputAsset → amountChf undefined → bookReceivedOwedOpening throws (m6 fail-loud): a CHF owed
      // opening booked with native 0 can never be revalued, so a missing mark must roll back the cutover, not silently
      // drop the value.
      await this.bookReceivedOwedOpening(
        date,
        `${snapshot.id}:buy_crypto-owed:${row.id}`,
        `Opening buyCrypto-owed from open buy_crypto #${row.id}`,
        liability,
        amountChf,
        equity,
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
    bankByIban: Map<string, Bank>,
  ): Promise<void> {
    const rows = await this.bankTxReturnRepo.find({
      where: { chargebackBankTx: IsNull(), created: Between(lookback, date) },
      relations: { bankTx: true },
    });
    const liability = await this.liability('bankTx-return');

    for (const row of rows) {
      await this.openOpenLiabilityRow(
        snapshot,
        date,
        marks,
        equity,
        liability,
        'bank_tx-return',
        row.bankTx,
        bankByIban,
      );
    }
  }

  // §6.1: same as openBankTxReturn for BANK_TX_REPEAT (`chargebackBankTx IS NULL`), marker `<logId>:bank_tx-repeat:<id>`
  private async openBankTxRepeat(
    snapshot: Log,
    date: Date,
    lookback: Date,
    marks: LedgerMarkCache,
    equity: LedgerAccount,
    bankByIban: Map<string, Bank>,
  ): Promise<void> {
    const rows = await this.bankTxRepeatRepo.find({
      where: { chargebackBankTx: IsNull(), created: Between(lookback, date) },
      relations: { bankTx: true },
    });
    const liability = await this.liability('bankTx-repeat');

    for (const row of rows) {
      await this.openOpenLiabilityRow(
        snapshot,
        date,
        marks,
        equity,
        liability,
        'bank_tx-repeat',
        row.bankTx,
        bankByIban,
      );
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
    bankByIban: Map<string, Bank>,
  ): Promise<void> {
    if (bankTx?.amount == null) return; // no underlying bank_tx amount → nothing to anchor

    const { mark } = this.bankMark(bankTx, date, marks, bankByIban);
    const amountChf = mark != null ? Util.round(bankTx.amount * mark, 2) : undefined;

    // feedless / no-bank-match → amountChf undefined → bookReceivedOwedOpening throws (m6 fail-loud): a CHF
    // return/repeat opening booked with native 0 is never revalued, so a missing mark rolls back the cutover.
    await this.bookReceivedOwedOpening(
      date,
      `${snapshot.id}:${marker}:${bankTx.id}`,
      `Opening ${marker} from open bank_tx #${bankTx.id}`,
      liability,
      amountChf,
      equity,
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
    bankByIban: Map<string, Bank>,
  ): Promise<void> {
    // §6.1: type NULL/Pending/Unknown/GSheet credits → the unattributed bucket (one query, two where-branches ORed
    // for the NULL type)
    const credit = { creditDebitIndicator: BankTxIndicator.CREDIT, created: Between(lookback, date) };
    const rows = await this.bankTxRepo.find({
      where: [
        { ...credit, type: In(UNATTRIBUTED_TYPES) },
        { ...credit, type: IsNull() },
      ],
    });

    let amountChf = 0;
    let needsMark = false;
    for (const row of rows) {
      if (row.amount == null) continue;
      const { mark } = this.bankMark(row, date, marks, bankByIban);
      if (mark == null) {
        needsMark = true; // a feedless/unmatched credit cannot be valued now → mark-to-market values the rest later
        continue;
      }
      amountChf += Util.round(row.amount * mark, 2);
    }

    if (Math.abs(amountChf) <= 1e-8 && !needsMark) return; // no open unattributed credits → no opening

    const liability = await this.liability('unattributed');
    // a feedless/unmatched credit leaves the aggregate unvaluable → amountChf undefined → bookReceivedOwedOpening
    // throws (m6 fail-loud): the CHF unattributed bucket is booked with native 0 and can never be revalued, so a
    // missing mark rolls back the cutover rather than dropping the value into a stale zero-opening.
    await this.bookReceivedOwedOpening(
      date,
      `${snapshot.id}:unattributed`,
      `Opening unattributed from open bank_tx credits as of FinancialDataLog #${snapshot.id}`,
      liability,
      needsMark ? undefined : Util.round(amountChf, 2),
      equity,
    );
  }

  // every bank keyed by IBAN, loaded ONCE per cutover (§6.1) so the per-row bank leg is valued from an in-memory map
  // instead of a per-row bankRepo.findOne (N+1). Banks without an IBAN are skipped (no accountIban can match them).
  private async bankByIban(): Promise<Map<string, Bank>> {
    const banks = await this.bankRepo.find({ relations: { asset: true } });
    return new Map(banks.filter((b) => b.iban != null).map((b) => [b.iban, b]));
  }

  // the bank's currency asset + its CHF mark (≤ snapshot) for a bank_tx (via accountIban → Bank.asset, §4.2/§1.6).
  // CHF bank → mark 1; EUR bank → EUR-mark from the cache; no bank match / feedless → mark undefined (caller needsMark).
  private bankMark(
    bankTx: BankTx,
    date: Date,
    marks: LedgerMarkCache,
    bankByIban: Map<string, Bank>,
  ): { asset?: Asset; mark: number | undefined } {
    const bank = bankTx.accountIban ? bankByIban.get(bankTx.accountIban) : undefined;
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
    for (const position of debts) {
      if (!position?.value) continue;

      const rawPrice = finance.assets[position.assetId]?.priceChf;
      const priceChf = Number.isFinite(rawPrice) ? rawPrice : undefined;
      const amountChf = priceChf != null ? Util.round(priceChf * position.value, 2) : undefined;

      // feedless asset (no priceChf in the snapshot) → amountChf undefined → bookReceivedOwedOpening throws (m6
      // fail-loud): the manual-debt LIABILITY is CHF-denominated with NO assetId, so the mark-to-market job can NEVER
      // revalue it — a missing price must abort the cutover run (already-booked openings are skipped idempotently on
      // the retry once the price feed is available), not silently drop the CHF value or book native units on a CHF
      // account.
      await this.bookReceivedOwedOpening(
        snapshotDate,
        `${snapshot.id}:manual-debt:${position.assetId}`,
        `Opening manual-debt for asset #${position.assetId} from FinancialDataLog #${snapshot.id}`,
        manualDebt,
        amountChf,
        equity,
      );
    }
  }

  // --- WATERMARK INIT (§6.3 step 3, Blocker R3-1) --- //

  // pins each ledgerWatermark.<source> to MAX(id) of pre-cutover settled rows + lastReversalScan = snapshotDate, and
  // (guard sources) the cutover boundary — ONCE, up front (BEFORE any opening), set-only-if-unset: a retry after a
  // fail-loud opening reuses the pinned values verbatim, so the forward consumers never re-book a row whose settlement
  // the opening already covers (no double-count). ALL nine consumer sources MUST be initialised here (§6.3 Z.910-917,
  // Blocker R3-1) — a missing watermark would default the consumer to lastProcessedId:0 → WHERE id>0 full-history
  // backfill (Hard Constraint #4 + ASSET double-count vs the openAssets openings, §6.1). The settled-filter per source
  // is exactly the §4.x consumer filter (§6.3 Z.917).
  private async initWatermarks(snapshotDate: Date): Promise<void> {
    // per-source settled filters (§4.x / §6.3 Z.917) — each extracted into a named const so the SAME predicate is
    // reused for BOTH the MAX(id) boundary and the open-hole id query. Filter identity guarantees consistent
    // classification only WITHIN one computation; across a fail-loud retry it holds ONLY because boundary+watermark
    // are pinned set-only-if-unset on the FIRST run, BEFORE any opening (loop below). Four guard sources are keyed on
    // the mutable `updated` (exchange_tx on the immutable externalCreated): an `updated` bump between runs would
    // otherwise flip a settled-at-snapshot row's classification — recorded as a NEW hole, or dropped from a shrunken
    // boundary — and its forward seq0 would double-book the aggregate opening (ASSET double-count + phantom liability).
    const ciFilter = (qb: SelectQueryBuilder<CryptoInput>) =>
      qb.andWhere('e.status IN (:...ciStatus)', { ciStatus: CryptoInputSettledStatus });
    const poFilter = (qb: SelectQueryBuilder<PayoutOrder>) =>
      qb.andWhere('e.status = :poStatus', { poStatus: PayoutOrderStatus.COMPLETE });
    const etFilter = (qb: SelectQueryBuilder<ExchangeTx>) => qb.andWhere('e.status = :etStatus', { etStatus: 'ok' });
    const lmFilter = (qb: SelectQueryBuilder<LiquidityManagementOrder>) =>
      qb.andWhere('e.status = :lmStatus', { lmStatus: LiquidityManagementOrderStatus.COMPLETE });
    const toFilter = (qb: SelectQueryBuilder<TradingOrder>) =>
      qb.andWhere('e.status = :toStatus', { toStatus: TradingOrderStatus.COMPLETE }).andWhere('e.txId IS NOT NULL');
    const loFilter = (qb: SelectQueryBuilder<LiquidityOrder>) =>
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
        });

    // The 5 guard sources ALSO persist a cutover boundary (boundaryId + holeIds) via `holeIds`; bank_tx/payout_order/
    // buy_crypto/buy_fiat keep watermark-only (no holeIds). The watermark value is unchanged for every source.
    const sources: {
      source: string;
      maxId: () => Promise<number>;
      holeIds?: (boundaryId: number) => Promise<number[]>;
    }[] = [
      { source: 'bank_tx', maxId: () => this.maxSettledId(this.bankTxRepo, 'bookingDate', snapshotDate) },
      // §4.4 — crypto_input: status ∈ CryptoInputSettledStatus + updated <= snapshot (§6.3 Z.917)
      {
        source: 'crypto_input',
        maxId: () => this.maxSettledId(this.cryptoInputRepo, 'updated', snapshotDate, ciFilter),
        holeIds: (b) => this.openHoleIds(this.cryptoInputRepo, b, snapshotDate, 'updated', ciFilter),
      },
      // §4.5 — payout_order: status='Complete' + updated <= snapshot (§6.3 Z.917)
      {
        source: 'payout_order',
        maxId: () => this.maxSettledId(this.payoutOrderRepo, 'updated', snapshotDate, poFilter),
      },
      // §4.3 — exchange_tx: status='ok' + (externalCreated ?? created) <= snapshot (§6.3 Z.917)
      {
        source: 'exchange_tx',
        maxId: () => this.maxSettledId(this.exchangeTxRepo, 'externalCreated', snapshotDate, etFilter),
        holeIds: (b) => this.openHoleIds(this.exchangeTxRepo, b, snapshotDate, 'externalCreated', etFilter),
      },
      { source: 'buy_crypto', maxId: () => this.maxSettledId(this.buyCryptoRepo, 'updated', snapshotDate) },
      { source: 'buy_fiat', maxId: () => this.maxSettledId(this.buyFiatRepo, 'updated', snapshotDate) },
      // §4.8 — liquidity_management_order: status='Complete' + updated <= snapshot
      {
        source: 'liquidity_management_order',
        maxId: () => this.maxSettledId(this.liquidityManagementOrderRepo, 'updated', snapshotDate, lmFilter),
        holeIds: (b) => this.openHoleIds(this.liquidityManagementOrderRepo, b, snapshotDate, 'updated', lmFilter),
      },
      // §4.9 — trading_order: status='Complete' AND txId IS NOT NULL + updated <= snapshot
      {
        source: 'trading_order',
        maxId: () => this.maxSettledId(this.tradingOrderRepo, 'updated', snapshotDate, toFilter),
        holeIds: (b) => this.openHoleIds(this.tradingOrderRepo, b, snapshotDate, 'updated', toFilter),
      },
      // §4.8a — liquidity_order: txId IS NOT NULL AND context IN (...) AND type IN ('Purchase','Sell') + updated <= snapshot
      {
        source: 'liquidity_order',
        maxId: () => this.maxSettledId(this.liquidityOrderRepo, 'updated', snapshotDate, loFilter),
        holeIds: (b) => this.openHoleIds(this.liquidityOrderRepo, b, snapshotDate, 'updated', loFilter),
      },
    ];

    // set-only-if-unset (§6.3): recomputing on a retry would re-evaluate the settled predicates against a drifted DB —
    // a guard-source row settled at the snapshot whose `updated` was bumped in [snapshot → retry] falls out of the
    // predicate (shrunken boundary or a new hole) and its forward seq0 double-books the aggregate opening. ACCEPTED
    // RESIDUAL: a tiny window remains between the snapshot's `created` timestamp and each source's pin below —
    // a guard-source row settled at-or-before the snapshot whose `updated` is bumped inside that window is still
    // misclassified. Once a source is pinned its window is closed for good; only a crash INSIDE this pin step
    // (a transient infrastructure error — no mark-feed dependency exists here, unlike the openings) leaves the
    // not-yet-pinned sources to be computed on the retry, so the exposure stays bounded to pin-step execution
    // latency (seconds per attempt), unlike the pre-fix ordering where every fail-loud OPENING (missing mark,
    // potentially hours until the feed recovers) re-opened the full recompute window for ALL sources →
    // deliberately not closed with a heavier snapshot/lock mechanism.
    for (const { source, maxId, holeIds } of sources) {
      const watermarkPinned = (await this.settingService.get(`${WATERMARK_KEY_PREFIX}${source}`)) != null;
      const pinnedBoundary = holeIds ? await getCutoverBoundary(this.settingService, source) : undefined;

      if (watermarkPinned && (!holeIds || pinnedBoundary)) continue; // fully pinned on a prior run → reuse verbatim

      const boundaryId = pinnedBoundary ? pinnedBoundary.boundaryId : await maxId();

      // boundary FIRST, then the watermark derived from it: a crash between the two writes leaves the boundary
      // pinned and the retry re-derives the watermark from it → lastProcessedId == boundaryId holds across retries
      if (holeIds && !pinnedBoundary) {
        await setCutoverBoundary(this.settingService, source, { boundaryId, holeIds: await holeIds(boundaryId) });
      }
      if (!watermarkPinned) {
        await this.setWatermark(source, boundaryId, snapshotDate); // lastProcessedId derived from the (pinned) boundary
      }
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

  // §6.3 — ids <= boundaryId that were OPEN (not settled) at the snapshot and created within OPEN_ROW_LOOKBACK_DAYS.
  // = (recent ids <= boundary) MINUS (recent SETTLED ids <= boundary), reusing the exact per-source settled filter for
  // a consistent classification WITHIN this computation. Across runs the classification is frozen because the RESULT
  // is pinned once (set-only-if-unset, initWatermarks) — the filter alone is not time-invariant: an `updated` bump
  // between runs would flip a settled-at-snapshot row into a hole, re-booking it post-cutover → double-count.
  // A >OPEN_ROW_LOOKBACK_DAYS-old unsettled row is treated as terminal (excluded), consistent with openLiabilities.
  private async openHoleIds<T>(
    repo: Repository<T>,
    boundaryId: number,
    snapshotDate: Date,
    dateColumn: string,
    filter?: (qb: SelectQueryBuilder<T>) => SelectQueryBuilder<T>,
  ): Promise<number[]> {
    if (boundaryId <= 0) return []; // boundary 0 = nothing settled at the snapshot → no id <= boundary → no holes
    const cutoff = Util.daysBefore(OPEN_ROW_LOOKBACK_DAYS, snapshotDate);
    const allRecent = await this.idsUpToBoundary(repo, boundaryId, cutoff);
    const settledRecent = await this.idsUpToBoundary(repo, boundaryId, cutoff, snapshotDate, dateColumn, filter);
    const settled = new Set(settledRecent);
    return allRecent.filter((id) => !settled.has(id));
  }

  // ids <= boundaryId created after `cutoff`. With `snapshotDate`+`dateColumn`(+filter) it additionally restricts to
  // rows SETTLED at the snapshot (the per-source predicate), mirroring maxSettledId's `COALESCE(e.<col>, e.created)
  // <= :date` verbatim so there is no new Postgres-quoting divergence from that method (alias `e`, `e.id` selected).
  private async idsUpToBoundary<T>(
    repo: Repository<T>,
    boundaryId: number,
    cutoff: Date,
    snapshotDate?: Date,
    dateColumn?: string,
    filter?: (qb: SelectQueryBuilder<T>) => SelectQueryBuilder<T>,
  ): Promise<number[]> {
    let qb = repo
      .createQueryBuilder('e')
      .select('e.id', 'id')
      .where('e.id <= :boundaryId', { boundaryId })
      .andWhere('e.created > :cutoff', { cutoff });
    if (snapshotDate && dateColumn)
      qb = qb.andWhere(`COALESCE(e.${dateColumn}, e.created) <= :snap`, { snap: snapshotDate });
    if (filter) qb = filter(qb);
    const rows = await qb.getRawMany<{ id: number }>();
    return rows.map((r) => +r.id);
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
    bookingDate: Date,
    sourceId: string,
    description: string,
    liability: LedgerAccount,
    amountChf: number | undefined,
    equity: LedgerAccount,
  ): Promise<void> {
    // m6 fail-loud: a received/owed/unattributed/manual-debt opening lives on a CHF-denominated LIABILITY
    // (assetId=NULL) and would be booked with native 0, so the mark-to-market job (assetId IS NOT NULL, native≠0) can
    // NEVER revalue it. Booking it with amountChf=undefined would silently drop the liability's value forever. If the
    // required mark is missing, throw: the whole cutover rolls back, the ledger-ready flag stays unset, and the next
    // cron run retries once the mark feed is available. Never a stale zero-opening.
    if (amountChf == null) {
      throw new Error(
        `Cutover opening ${sourceId} without a mark would silently drop the value (CHF liability, never revalued by mark-to-market) — retry when the mark feed is available`,
      );
    }

    await this.bookOpening(
      0,
      sourceId,
      description,
      bookingDate,
      { account: liability, amount: -amountChf, priceChf: 1, amountChf: -amountChf, needsMark: false },
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
