import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger, LogLevel } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { BankTx, BankTxIndicator, BankTxType } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxRepeat } from 'src/subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.entity';
import { BankTxReturn } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.entity';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { IsNull, LessThan, MoreThan, Not, Repository } from 'typeorm';
import { AccountType, LedgerAccount } from '../../entities/ledger-account.entity';
import { LedgerLeg } from '../../entities/ledger-leg.entity';
import { LedgerTx } from '../../entities/ledger-tx.entity';
import { LedgerAccountService } from '../ledger-account.service';
import { LedgerBookingService, LedgerLegInput, LedgerTxInput } from '../ledger-booking.service';
import { LedgerMarkCache, LedgerMarkService } from '../ledger-mark.service';
import { LedgerGateBlockedException } from './ledger-gate-blocked.exception';
import { resolveLegsOrDefer } from './ledger-mark-bridge.helper';
import { getLedgerWatermark, runContentChangeScan, setLedgerWatermark } from './ledger-watermark.helper';

const SOURCE_TYPE = 'bank_tx';
const CUTOVER_SOURCE = 'cutover';
const CUTOVER_LOG_ID_KEY = 'ledgerCutoverLogId';
const BUY_CRYPTO_OWED = 'LIABILITY/buyCrypto-owed';
const CHF = 'CHF';
const LIABILITY_PREFIX = 'LIABILITY/';

// bank-side exchange route segment per type (§3.3 {ex}); SCB route is created lazily (§3.3 "new routes lazily")
const EXCHANGE_ROUTE: Partial<Record<BankTxType, string>> = {
  [BankTxType.KRAKEN]: 'Kraken',
  [BankTxType.SCRYPT]: 'Scrypt',
  [BankTxType.SCB]: 'SCB',
};

interface BankContext {
  asset?: Asset; // the bank's currency asset (EUR/CHF); undefined → untracked bank → SUSPENSE
  currency: string;
  bankName?: string;
  tracked: boolean;
  // the asset id whose FinancialDataLog mark values the bank/SUSPENSE leg (§4.2a). For a tracked bank it IS
  // `asset.id`; for an UNTRACKED bank (Raiffeisen etc.) it is a representative same-currency tracked-bank asset id
  // (the EUR mark is identical across all EUR bank assets) so the SUSPENSE leg is EUR-mark-valued and the §4.2a plug
  // stays a small valuation residual instead of a full-value phantom. undefined → no mark → needsMark, no silent plug.
  markAssetId?: number;
}

/**
 * Books all 19 BankTxType constellations (§4.2 + §4.2a). Pure observer: reads bank_tx (+ Bank for the
 * accountIban→bank.asset lookup), writes only ledger_*.
 *
 * Non-CHF bank accounts get a 3-leg fx-revaluation plug (§4.2a Major R11-1); CHF accounts collapse to 2-leg.
 * BUY_FIAT rows are skipped entirely (settlement booked by the BuyFiat consumer seq3, Blocker R4-1).
 */
@Injectable()
export class BankTxConsumer {
  private readonly logger = new DfxLogger(BankTxConsumer);

  constructor(
    private readonly settingService: SettingService,
    private readonly bookingService: LedgerBookingService,
    private readonly accountService: LedgerAccountService,
    private readonly markService: LedgerMarkService,
    @InjectRepository(BankTx) private readonly bankTxRepo: Repository<BankTx>,
    @InjectRepository(Bank) private readonly bankRepo: Repository<Bank>,
    @InjectRepository(LedgerTx) private readonly ledgerTxRepo: Repository<LedgerTx>,
    // read-only: resolve a chargeback bank_tx → its original BANK_TX_RETURN/REPEAT opening row (§4.2 opening-CHF anchor)
    @InjectRepository(BankTxReturn) private readonly bankTxReturnRepo: Repository<BankTxReturn>,
    @InjectRepository(BankTxRepeat) private readonly bankTxRepeatRepo: Repository<BankTxRepeat>,
  ) {}

  async process(): Promise<void> {
    const watermark = (await getLedgerWatermark(this.settingService, SOURCE_TYPE)) ?? {
      lastProcessedId: 0,
      lastReversalScan: new Date(0),
    };

    await this.processForward(watermark);

    // content-change scan (§4.12): re-classification of an already-booked bank_tx (the §4.12 textbook example
    // GSHEET→BUY_CRYPTO via updateInternal; also amount / creditDebitIndicator changes, §4.2 reversal triggers, and
    // a reset()→PENDING) recomputes the seq0 legs and, if they differ beyond the §4.12 tolerances, reverses the
    // active tx + re-books the corrected legs. Runs ALSO when the forward batch is empty. Re-read the watermark in
    // case the forward batch advanced lastProcessedId above.
    const afterForward = (await getLedgerWatermark(this.settingService, SOURCE_TYPE)) ?? watermark;
    await runContentChangeScan(
      this.settingService,
      SOURCE_TYPE,
      afterForward,
      this.bankTxRepo,
      { buyCrypto: true, buyCryptoChargeback: true },
      async (tx: BankTx) => {
        const t = tx.bookingDate ?? tx.created;
        await this.reconcileBooking(
          tx,
          // lookback so getMarkAt finds the latest mark at-or-before the row timestamp
          await this.markService.preload(Util.daysBefore(2, t), t),
        );
      },
    );
  }

  private async processForward(watermark: { lastProcessedId: number; lastReversalScan: Date }): Promise<void> {
    // DBIT only after 5 min (analog assignTransactions); settlement = bookingDate ?? created (§4.2)
    const batch = await this.bankTxRepo.find({
      where: { id: MoreThan(watermark.lastProcessedId), created: LessThan(Util.minutesBefore(5)) },
      relations: { buyCrypto: true, buyCryptoChargeback: true },
      order: { id: 'ASC' },
      take: Config.ledger.backfillBatchSize,
    });
    if (!batch.length) return;

    // settlement can predate `created` (bookingDate ?? created feeds getMarkAt); anchor the mark lookback on the
    // earliest settlement so getMarkAt finds a mark at-or-before every row's bookingDate (else the earliest row wedges)
    const from = Util.daysBefore(2, new Date(Math.min(...batch.map((tx) => (tx.bookingDate ?? tx.created).getTime()))));
    const to = Util.maxObj(batch, 'created').created;
    const marks = await this.markService.preload(from, to);

    let lastProcessedId = watermark.lastProcessedId;
    for (const tx of batch) {
      try {
        await this.book(tx, marks);
        lastProcessedId = tx.id;
      } catch (e) {
        // a gate-block (AML pricing pending or chargeback link pending) is the designed self-healing retry signal — verbose, not error (§4.12 pattern)
        const gateBlocked = e instanceof LedgerGateBlockedException;
        this.logger.log(
          gateBlocked ? LogLevel.VERBOSE : LogLevel.ERROR,
          `${gateBlocked ? 'Booking gate-blocked on' : 'Failed to book'} bank_tx ${tx.id}:`,
          e,
        );
        break; // failure-isolation: leave watermark unchanged, retry next run (§4-header)
      }
    }

    if (lastProcessedId > watermark.lastProcessedId) {
      await setLedgerWatermark(this.settingService, SOURCE_TYPE, { ...watermark, lastProcessedId });
    }
  }

  private async book(tx: BankTx, marks: LedgerMarkCache): Promise<void> {
    const input = await this.buildSeq0Input(tx, marks);
    if (!input) return; // skipped type (BUY_FIAT / TEST_FIAT_FIAT)

    await this.bookingService.bookTx(input);
  }

  // §4.12 — recompute the seq0 legs for an already-booked row; reverse + re-book only if a trigger field changed
  // (type/amount/creditDebitIndicator, §4.2). The booking service compares against the active tx within the §4.12
  // float tolerances and no-ops when nothing changed (idempotent re-scan). A row that is no longer bookable (type
  // became BUY_FIAT/TEST_FIAT_FIAT) is reversed flat (its active legs inverted, no re-book).
  private async reconcileBooking(tx: BankTx, marks: LedgerMarkCache): Promise<void> {
    const input = await this.buildSeq0Input(tx, marks);
    if (!input) {
      await this.bookingService.reverseActiveIfBooked(SOURCE_TYPE, `${tx.id}`, 0); // type became skip → flat reversal
      return;
    }

    await this.bookingService.reverseAndRebookIfChanged(input);
  }

  // builds the seq0 LedgerTxInput for a bank_tx, or undefined for a skipped type (BUY_FIAT / TEST_FIAT_FIAT)
  private async buildSeq0Input(tx: BankTx, marks: LedgerMarkCache): Promise<LedgerTxInput | undefined> {
    const bookingDate = tx.bookingDate ?? tx.created;
    const valueDate = tx.valueDate ?? bookingDate;
    const ctx = await this.bankContext(tx);
    const isCredit = tx.creditDebitIndicator === BankTxIndicator.CREDIT;

    const legs = await this.buildLegs(tx, ctx, bookingDate, marks, isCredit);
    if (!legs) return undefined; // skipped type (BUY_FIAT / TEST_FIAT_FIAT)

    return { sourceType: SOURCE_TYPE, sourceId: `${tx.id}`, seq: 0, bookingDate, valueDate, legs };
  }

  private async buildLegs(
    tx: BankTx,
    ctx: BankContext,
    bookingDate: Date,
    marks: LedgerMarkCache,
    isCredit: boolean,
  ): Promise<LedgerLegInput[] | undefined> {
    switch (tx.type) {
      case BankTxType.BUY_FIAT:
        // BUY_FIAT settlement booked by buy_fiat consumer seq3 (this row IS fiatOutput.bankTx); skip to avoid
        // double-debiting ASSET/bank (Blocker R4-1)
        return undefined;

      case BankTxType.TEST_FIAT_FIAT:
        return undefined; // mapper=null → not booked (§4.2)

      case BankTxType.BUY_CRYPTO:
        return this.buyCryptoLegs(tx, ctx, bookingDate, marks);

      case BankTxType.BUY_CRYPTO_RETURN:
        return this.buyCryptoReturnLegs(tx, ctx, bookingDate, marks);

      case BankTxType.KRAKEN:
      case BankTxType.SCRYPT:
      case BankTxType.SCB:
        return this.exchangeTransitLegs(tx, ctx, bookingDate, marks, isCredit);

      case BankTxType.INTERNAL:
        return this.transferLegs(tx, ctx, bookingDate, marks, isCredit, `TRANSIT/bank↔bank/${ctx.currency}`);

      case BankTxType.FIAT_FIAT:
        // single-row FX-credit (Muster 1): open side held in TRANSIT/internal-fx, mark-to-market job catches drift
        return this.transferLegs(tx, ctx, bookingDate, marks, isCredit, `TRANSIT/internal-fx/${ctx.currency}`);

      case BankTxType.BANK_ACCOUNT_FEE:
        return this.bankAccountFeeLegs(tx, ctx, bookingDate, marks);

      case BankTxType.EXTRAORDINARY_EXPENSES:
        return this.expenseLegs(tx, ctx, bookingDate, marks, 'extraordinary');

      case BankTxType.BANK_TX_RETURN:
        return this.liabilityCreditLegs(tx, ctx, bookingDate, marks, 'bankTx-return');

      case BankTxType.BANK_TX_RETURN_CHARGEBACK:
        return this.chargebackLegs(tx, ctx, bookingDate, marks, 'bankTx-return');

      case BankTxType.BANK_TX_REPEAT:
        return this.liabilityCreditLegs(tx, ctx, bookingDate, marks, 'bankTx-repeat');

      case BankTxType.BANK_TX_REPEAT_CHARGEBACK:
        return this.liabilityDebitLegs(tx, ctx, bookingDate, marks, 'bankTx-repeat');

      case BankTxType.CHECKOUT_LTD:
        return this.checkoutLtdLegs(tx, ctx, bookingDate, marks);

      case BankTxType.GSHEET:
      case BankTxType.PENDING:
        return isCredit
          ? this.liabilityCreditLegs(tx, ctx, bookingDate, marks, 'unattributed')
          : this.suspenseLegs(tx, ctx, bookingDate, marks, isCredit);

      case BankTxType.UNKNOWN:
        return this.suspenseLegs(tx, ctx, bookingDate, marks, isCredit);

      default:
        this.logger.error(`Unhandled bank_tx type ${tx.type} on bank_tx ${tx.id}`);
        return undefined;
    }
  }

  // --- TYPE LEG BUILDERS --- //

  // §4.2/§4.2a — BUY_CRYPTO CRDT: Dr ASSET/bank (or SUSPENSE/untracked) / Cr LIABILITY/buyCrypto-received + fx-plug
  private async buyCryptoLegs(
    tx: BankTx,
    ctx: BankContext,
    bookingDate: Date,
    marks: LedgerMarkCache,
  ): Promise<LedgerLegInput[]> {
    const amountInChf = tx.buyCrypto?.amountInChf; // received-Cr base anchor (Major R4-4)
    if (amountInChf == null) {
      // transient ONLY while the AML check has not run yet (doAmlCheck prices amlCheck==null rows); a linked row with an
      // amlCheck result and no CHF (e.g. FAIL set by chargebackFillUp on a not-yet-priced row) is never re-priced → fail loud
      if (tx.buyCrypto != null && tx.buyCrypto.amlCheck == null)
        throw new LedgerGateBlockedException(
          `bank_tx ${tx.id} BUY_CRYPTO without buyCrypto.amountInChf (AML pricing pending) — retry next run`,
        );
      throw new Error(`bank_tx ${tx.id} BUY_CRYPTO without buyCrypto.amountInChf`);
    }

    const bank = this.bankAssetLeg(ctx, +tx.amount, bookingDate, marks, await this.bankAccount(ctx)); // mark-consistent
    const received = this.namedLeg(await this.liability('buyCrypto-received'), -amountInChf);

    return this.withFxPlug([bank, received], `bank_tx ${tx.id} buy_crypto`);
  }

  // §4.2a — BUY_CRYPTO_RETURN DBIT: Dr LIABILITY/buyCrypto-owed (completion/opening CHF) / Cr ASSET/bank (EUR-mark ×
  // amount) + fx-plug. The owed-Dr MUST carry the SAME CHF the owed was OPENED with (§4.6 seq1 completion
  // `amountInChf − totalFeeAmountChf`, or the cutover opening for a straddling row) — NOT the bank-mark return value
  // (that would make withFxPlug always net to 0 → no plug → the Completion↔Return mark drift stays phantom on owed,
  // owed never closes; Major R2-2-symmetry).
  private async buyCryptoReturnLegs(
    tx: BankTx,
    ctx: BankContext,
    bookingDate: Date,
    marks: LedgerMarkCache,
  ): Promise<LedgerLegInput[]> {
    const bank = this.bankAssetLeg(ctx, -tx.amount, bookingDate, marks, await this.bankAccount(ctx));
    const owedChf = await this.buyCryptoOwedChf(tx);
    const owed = this.namedLeg(await this.liability('buyCrypto-owed'), owedChf);
    const legs: LedgerLegInput[] = [owed, bank];

    // §4.2 Frick inline charge: reclassify the charge from the fx-revaluation plug into an explicit EXPENSE/bank-fee —
    // the owed anchor is NOT reduced, so the plug simply shrinks by chargeChf (a null inline → unchanged legs).
    const inline = await this.inlineBankCharge(tx, ctx, bank);
    if (inline) legs.push(this.namedLeg(await this.expense('bank-fee'), inline.chargeChf));

    // owed-Dr (completion/opening CHF) + bank-Cr (EUR-mark) → withFxPlug routes the mark/valuation drift to
    // EXPENSE/INCOME fx-revaluation, owed closes cent-exact to 0 (§4.2a). CHF account → drift 0 → 2-leg, no plug.
    return this.withFxPlug(legs, `bank_tx ${tx.id} buy_crypto_return`);
  }

  // the CHF the buyCrypto-owed was opened with: §4.6 completion (amountInChf − totalFeeAmountChf), or — for a
  // cutover-straddling buy_crypto whose owed was opened by the cutover (§6.1 per-row marker) — the opening CHF.
  private async buyCryptoOwedChf(tx: BankTx): Promise<number> {
    // the charged-back buy_crypto hangs off buy_crypto.chargebackBankTx (→ tx.buyCryptoChargeback), NOT the incoming
    // buy_crypto.bankTx (→ tx.buyCrypto, which is undefined for a RETURN row); a return closes the owed of the row it
    // charges back
    const openingChf = await this.cutoverOwedOpeningChf(tx.buyCryptoChargeback?.id);
    if (openingChf != null) return openingChf; // cutover-straddling: debit the exact opening CHF anchor

    const amountInChf = tx.buyCryptoChargeback?.amountInChf;
    if (amountInChf == null) {
      // unlinked = transient link race (the chargebackFillUp cron links the return bank_tx); a LINKED chargeback with
      // no CHF is permanently unpriced (FAIL rows are never re-priced) → fail loud
      if (tx.buyCryptoChargeback == null)
        throw new LedgerGateBlockedException(
          `bank_tx ${tx.id} BUY_CRYPTO_RETURN not yet linked to its buy_crypto chargeback — retry next run`,
        );
      throw new Error(`bank_tx ${tx.id} BUY_CRYPTO_RETURN without buyCryptoChargeback.amountInChf`);
    }
    return Util.round(amountInChf - (tx.buyCryptoChargeback?.totalFeeAmountChf ?? 0), 2); // completion CHF (additive null-strategy)
  }

  // looks up the cutover per-row owed-opening leg CHF (§6.1 marker `${snapshotLogId}:buy_crypto-owed:${id}`); the
  // prefix is the snapshot logId persisted in ledgerCutoverLogId. Returns undefined for a regular post-cutover row.
  private async cutoverOwedOpeningChf(buyCryptoId: number | undefined): Promise<number | undefined> {
    if (buyCryptoId == null) return undefined;
    const cutoverLogId = await this.settingService.get(CUTOVER_LOG_ID_KEY);
    if (cutoverLogId == null) return undefined;

    const opening = await this.ledgerTxRepo.findOne({
      where: { sourceType: CUTOVER_SOURCE, sourceId: `${cutoverLogId}:buy_crypto-owed:${buyCryptoId}` },
      relations: { legs: { account: true } },
    });
    const leg = opening?.legs?.find((l: LedgerLeg) => l.account?.name === BUY_CRYPTO_OWED);
    if (leg?.amountChf == null) return undefined;

    return Util.round(-leg.amountChf, 2); // the opening Cr leg is −openingChf → owed-Dr debits +openingChf
  }

  // §4.2 KRAKEN/SCRYPT/SCB: Dr/Cr ASSET/bank ↔ TRANSIT/bank↔{ex}/{ccy}
  private async exchangeTransitLegs(
    tx: BankTx,
    ctx: BankContext,
    bookingDate: Date,
    marks: LedgerMarkCache,
    isCredit: boolean,
  ): Promise<LedgerLegInput[]> {
    return this.transferLegs(
      tx,
      ctx,
      bookingDate,
      marks,
      isCredit,
      `TRANSIT/bank↔${EXCHANGE_ROUTE[tx.type]}/${ctx.currency}`,
    );
  }

  // bank ASSET ↔ TRANSIT same-currency transfer; both legs carry the same native+CHF, opposite signs
  private async transferLegs(
    tx: BankTx,
    ctx: BankContext,
    bookingDate: Date,
    marks: LedgerMarkCache,
    isCredit: boolean,
    counterName: string,
  ): Promise<LedgerLegInput[]> {
    const bank = this.bankAssetLeg(
      ctx,
      isCredit ? +tx.amount : -tx.amount,
      bookingDate,
      marks,
      await this.bankAccount(ctx),
    );
    const counterAccount = await this.accountService.findOrCreate(counterName, AccountType.TRANSIT, ctx.currency);
    const counter: LedgerLegInput = {
      account: counterAccount,
      amount: -bank.amount,
      priceChf: bank.priceChf,
      amountChf: bank.amountChf != null ? -bank.amountChf : undefined,
      needsMark: bank.needsMark,
    };

    // §4.2 Frick inline charge: a DEBIT's tx.amount is already gross → the bank leg stays gross; reclassify the charge
    // out of the mirrored counter into an explicit EXPENSE/bank-fee (a null inline → EXACTLY the prior legs).
    const inline = await this.inlineBankCharge(tx, ctx, bank);
    if (!inline) return [bank, counter]; // unchanged (incl. the markless needsMark-mirror case)

    counter.amount = Util.round(counter.amount - inline.chargeNative, 8); // gross → net (native, account ccy)
    // F1: net the CHF only when the bank leg carries a mark (counter.amountChf is set iff bank.amountChf is). With no
    // historical mark counter stays needsMark → resolveLegsOrDefer decides book-or-defer consistently with the fee leg;
    // force-setting a partial −chargeChf on a needsMark leg would skip the bridge and mis-plug the tx.
    if (counter.amountChf != null) counter.amountChf = Util.round(counter.amountChf - inline.chargeChf, 2);
    const legs = [bank, counter, this.namedLeg(await this.expense('bank-fee'), inline.chargeChf)];
    return this.withFxPlug(legs, `bank_tx ${tx.id} transfer`);
  }

  // §4.2 BANK_ACCOUNT_FEE: Dr EXPENSE/bank-fee (chargeAmountChf Pricing) / Cr ASSET/bank (EUR-mark × chargeAmount)
  private async bankAccountFeeLegs(
    tx: BankTx,
    ctx: BankContext,
    bookingDate: Date,
    marks: LedgerMarkCache,
  ): Promise<LedgerLegInput[]> {
    const charge = tx.chargeAmount ?? tx.amount;
    const bank = this.bankAssetLeg(ctx, -charge, bookingDate, marks, await this.bankAccount(ctx));
    const expenseChf = tx.chargeAmountChf ?? -(bank.amountChf ?? 0); // Pricing anchor
    const expense = this.namedLeg(await this.expense('bank-fee'), expenseChf);

    return this.withFxPlug([expense, bank], `bank_tx ${tx.id} bank_fee`); // ≤2c → ROUNDING, >2c → fx-revaluation (§4.2-Note B-10)
  }

  // §4.2 EXTRAORDINARY_EXPENSES: Dr EXPENSE/{name} / Cr ASSET/bank
  private async expenseLegs(
    tx: BankTx,
    ctx: BankContext,
    bookingDate: Date,
    marks: LedgerMarkCache,
    name: string,
  ): Promise<LedgerLegInput[]> {
    const bank = this.bankAssetLeg(ctx, -tx.amount, bookingDate, marks, await this.bankAccount(ctx));
    const expense = this.namedLeg(await this.expense(name), -(bank.amountChf ?? 0));

    // §4.2 Frick inline charge: split the charge portion out of the {name} expense into EXPENSE/bank-fee — the bank
    // leg stays gross (a null inline → EXACTLY the prior legs).
    const inline = await this.inlineBankCharge(tx, ctx, bank);
    if (!inline) return [expense, bank]; // unchanged

    expense.amount = Util.round(expense.amount - inline.chargeChf, 2);
    expense.amountChf = Util.round((expense.amountChf ?? 0) - inline.chargeChf, 2);
    const legs = [expense, bank, this.namedLeg(await this.expense('bank-fee'), inline.chargeChf)];
    return this.withFxPlug(legs, `bank_tx ${tx.id} ${name}`);
  }

  // §4.2 BANK_TX_RETURN/BANK_TX_REPEAT/unattributed CRDT: Dr ASSET/bank (EUR-mark) / Cr LIABILITY/{bucket}, 2-leg.
  // The bank-EUR ASSET leg is EUR-mark-valued (mark-consistent with the §7 feed); the CHF-denominated LIABILITY
  // (§3.4 currency=CHF, assetId=NULL) carries the SAME CHF (EUR-Mark × amount) → both legs share one CHF source, the
  // tx closes 2-leg with no FX plug. The liability balance is a FIXED CHF value and does NOT drift while open (it has
  // no native FX exposure on the ledger account) — the §4.2-Note "mark-to-market corrects the EUR↔CHF drift" is a
  // no-op for this CHF-stable balance (the mark-to-market job only re-marks asset-backed accounts, §5.3); any
  // EUR-mark mismatch surfaces only at the chargeback/settlement leg as a residual (plugged there, §4.2-Note B-15).
  private async liabilityCreditLegs(
    tx: BankTx,
    ctx: BankContext,
    bookingDate: Date,
    marks: LedgerMarkCache,
    bucket: string,
  ): Promise<LedgerLegInput[]> {
    const bank = this.bankAssetLeg(ctx, +tx.amount, bookingDate, marks, await this.bankAccount(ctx));
    const liability = this.namedLeg(await this.liability(bucket), -(bank.amountChf ?? 0));

    return [bank, liability];
  }

  // §4.2 BANK_TX_REPEAT_CHARGEBACK DBIT: Dr LIABILITY/{bucket} (opening CHF) / Cr ASSET/bank (EUR-mark) + fx-plug.
  // The owed/repeat LIABILITY was OPENED at the EUR-mark of the BANK_TX_REPEAT credit (§4.2 line 357 + Minor R11-4) —
  // its account is CHF-denominated (§3.4) and does NOT drift while open (the mark-to-market job only re-marks
  // asset-backed accounts, §5.3). If the chargeback debits the liability with the chargeback-time bank-mark instead of
  // the opening CHF, the EUR↔CHF mark drift between credit and chargeback stays as a PHANTOM on bankTx-repeat and the
  // liability never closes to 0. Anchor the LIABILITY-Dr on the opening CHF; the bank↔opening mark drift goes to
  // fx-revaluation via withFxPlug (the residual the §4.2 comment above said surfaces "plugged there", line 372).
  private async liabilityDebitLegs(
    tx: BankTx,
    ctx: BankContext,
    bookingDate: Date,
    marks: LedgerMarkCache,
    bucket: string,
  ): Promise<LedgerLegInput[]> {
    const bank = this.bankAssetLeg(ctx, -tx.amount, bookingDate, marks, await this.bankAccount(ctx));
    const others: LedgerLegInput[] = [bank];

    // §4.2 Frick inline charge: reclassify the charge from the fx-revaluation plug into an explicit EXPENSE/bank-fee.
    // Joined into `others` BEFORE the opening lookup, so the no-opening fallback (liability = −Σ others) closes over
    // the fee too — the charge stays expensed instead of being re-absorbed by the plug. With an opening found the
    // anchored liability is NOT reduced, so the plug simply shrinks by chargeChf (a null inline → unchanged).
    const inline = await this.inlineBankCharge(tx, ctx, bank);
    if (inline) others.push(this.namedLeg(await this.expense('bank-fee'), inline.chargeChf));

    const liabilityChf = await this.chargebackOpeningChf(tx, bucket, others);
    const liability = this.namedLeg(await this.liability(bucket), liabilityChf);

    // opening-CHF Dr + EUR-mark bank Cr → withFxPlug routes the mark/valuation drift to fx-revaluation, liability
    // closes cent-exact to 0. CHF account / no opening found → drift 0 → 2-leg, no plug (no behaviour change).
    return this.withFxPlug([liability, ...others], `bank_tx ${tx.id} liability_debit`);
  }

  // §4.2 BANK_TX_RETURN_CHARGEBACK DBIT: Dr LIABILITY/{bucket} (opening CHF) / Cr ASSET/bank (EUR-mark)
  // (+ EXPENSE/bank-fee chargeAmountChf). LIABILITY-Dr = the CHF the BANK_TX_RETURN credit OPENED the liability with
  // (§4.2 line 356 + B-15), NOT the chargeback-time close value. Closing on the close value (−Σ(bank+fee)) makes the
  // plug structurally always net to 0 → the EUR-mark drift between return and chargeback stays a phantom on
  // bankTx-return and the liability never closes. Anchor on the opening CHF; the residual (opening-CHF ↔ bank-EUR-mark
  // ↔ chargeAmountChf-Pricing) goes via withFxPlug to fx-revaluation (>2c) or ROUNDING (≤2c), §4.2-Note B-15.
  private async chargebackLegs(
    tx: BankTx,
    ctx: BankContext,
    bookingDate: Date,
    marks: LedgerMarkCache,
    bucket: string,
  ): Promise<LedgerLegInput[]> {
    const bank = this.bankAssetLeg(ctx, -tx.amount, bookingDate, marks, await this.bankAccount(ctx));
    const others: LedgerLegInput[] = [bank];

    const feeChf = tx.chargeAmountChf;
    if (feeChf != null && feeChf !== 0) others.push(this.namedLeg(await this.expense('bank-fee'), feeChf)); // Pricing anchor

    // §4.2 Frick inline charge: an inline charge (chargeAmountChf==null) is MUTUALLY EXCLUSIVE with the chargeAmountChf
    // fee leg above (that requires chargeAmountChf!=null) → no double-book. Joined into `others` BEFORE the opening
    // lookup, so the no-opening fallback (liability = −Σ others) closes over the fee too — the charge stays expensed
    // instead of being re-absorbed by the plug. With an opening found the anchored liability is NOT reduced, so the
    // plug simply shrinks by chargeChf (a null inline → unchanged).
    const inline = await this.inlineBankCharge(tx, ctx, bank);
    if (inline) others.push(this.namedLeg(await this.expense('bank-fee'), inline.chargeChf));

    const liabilityChf = await this.chargebackOpeningChf(tx, bucket, others);
    const legs: LedgerLegInput[] = [this.namedLeg(await this.liability(bucket), liabilityChf), ...others];

    return this.withFxPlug(legs, `bank_tx ${tx.id} chargeback`); // ≤2c → ROUNDING, >2c → fx-revaluation
  }

  // the CHF the LIABILITY/{bucket} was OPENED with (§4.2 line 356/357, B-15): looks up the original BANK_TX_RETURN /
  // BANK_TX_REPEAT opening row (via BankTxReturn/BankTxRepeat.chargebackBankTx → its `.bankTx`), then the CHF on the
  // bank_tx seq0 ledger opening leg for this {bucket}. For a cutover-straddling return/repeat (opened pre-cutover,
  // chargeback post-cutover) the opening is NOT a bank_tx seq0 tx but the cutover per-row opening (§6.1 Major
  // design-accounting, marker `<logId>:bank_tx-return|repeat:<openingBankTxId>`) → check that too before the fallback.
  // Falls back to closing against the OTHER legs (bank [+ fee]) only when no opening at all is found (an untracked
  // chain / opening older than the 90d cutover lookback) — the prior self-balancing 2-leg behaviour.
  private async chargebackOpeningChf(tx: BankTx, bucket: string, others: LedgerLegInput[]): Promise<number> {
    const openingBankTxId = await this.openingBankTxId(tx);
    if (openingBankTxId != null) {
      const openingChf = await this.openingLiabilityLegChf(openingBankTxId, bucket);
      if (openingChf != null) return openingChf;

      const cutoverChf = await this.cutoverOpeningLiabilityChf(openingBankTxId, bucket);
      if (cutoverChf != null) return cutoverChf;
    }

    return -others.reduce((s, l) => s + (l.amountChf ?? 0), 0); // fallback: liability = −Σ(other legs) → 2-leg balance
  }

  // resolves a chargeback bank_tx → the id of its original BANK_TX_RETURN/BANK_TX_REPEAT opening bank_tx. The link is
  // BankTxReturn.chargebackBankTx / BankTxRepeat.chargebackBankTx === this chargeback row; the opening row is `.bankTx`.
  private async openingBankTxId(chargebackTx: BankTx): Promise<number | undefined> {
    const ret = await this.bankTxReturnRepo.findOne({
      where: { chargebackBankTx: { id: chargebackTx.id } },
      relations: { bankTx: true },
    });
    if (ret?.bankTx?.id != null) return ret.bankTx.id;

    const rep = await this.bankTxRepeatRepo.findOne({
      where: { chargebackBankTx: { id: chargebackTx.id } },
      relations: { bankTx: true },
    });
    return rep?.bankTx?.id;
  }

  // the CHF on the {bucket} LIABILITY leg of the opening bank_tx's seq0 ledger_tx (= |opening Cr leg|, the value the
  // BANK_TX_RETURN/REPEAT credit opened the liability with). Returns undefined when the opening was never booked.
  private async openingLiabilityLegChf(openingBankTxId: number, bucket: string): Promise<number | undefined> {
    const opening = await this.ledgerTxRepo.findOne({
      where: { sourceType: SOURCE_TYPE, sourceId: `${openingBankTxId}`, seq: 0 },
      relations: { legs: { account: true } },
    });
    const leg = opening?.legs?.find((l: LedgerLeg) => l.account?.name === `${LIABILITY_PREFIX}${bucket}`);
    if (leg?.amountChf == null) return undefined;

    return Util.round(-leg.amountChf, 2); // opening Cr leg is −openingChf → chargeback Dr debits +openingChf
  }

  // the CHF on the {bucket} LIABILITY leg of the CUTOVER per-row opening for this return/repeat (§6.1 Major
  // design-accounting, marker `<logId>:bank_tx-return|repeat:<openingBankTxId>`). A pre-cutover open BANK_TX_RETURN/
  // REPEAT (chargebackBankTx IS NULL at the snapshot) was opened by the cutover, NOT the bank_tx consumer, so its
  // anchor lives under sourceType='cutover'. Returns undefined for a regular post-cutover chargeback (no cutover marker).
  private async cutoverOpeningLiabilityChf(openingBankTxId: number, bucket: string): Promise<number | undefined> {
    const cutoverLogId = await this.settingService.get(CUTOVER_LOG_ID_KEY);
    if (cutoverLogId == null) return undefined;

    const marker = bucket === 'bankTx-repeat' ? 'bank_tx-repeat' : 'bank_tx-return';
    const opening = await this.ledgerTxRepo.findOne({
      where: { sourceType: CUTOVER_SOURCE, sourceId: `${cutoverLogId}:${marker}:${openingBankTxId}` },
      relations: { legs: { account: true } },
    });
    const leg = opening?.legs?.find((l: LedgerLeg) => l.account?.name === `${LIABILITY_PREFIX}${bucket}`);
    if (leg?.amountChf == null) return undefined;

    return Util.round(-leg.amountChf, 2); // cutover Cr leg is −openingChf → chargeback Dr debits +openingChf
  }

  // §4.2 CHECKOUT_LTD CRDT: Dr ASSET/bank (net) + Dr EXPENSE/acquirer-fee (feeChf) / Cr ASSET/Checkout (gross).
  // Convention (F2): the Checkout/{ccy} custody account carries native GROSS in CARD currency on every leg and
  // amountChf = the corresponding gross CHF → amountChf ≈ mark × amount holds per leg AND on the account aggregate,
  // so the mark-to-market job flushes only genuine FX drift. Booking the NET native against the GROSS CHF (pre-fix)
  // broke that by exactly the acquirer fee → the mark-to-market job "corrected" it as a phantom */fx-revaluation
  // posting and the margin report counted the fee twice (executionCosts AND fxPnl).
  // The fee's card-currency native (feeNative) is resolved via a documented ladder — no silent assumption:
  //   1. feeChf === 0 → feeNative = 0. This covers "no fee" AND "fee not yet CHF-priced" (chargeAmount set but
  //      chargeAmountChf still null): the leg then temporarily books net-as-gross; the later CHF-pricing bumps
  //      `updated` → the content-change scan reverses+rebooks the corrected legs (self-healing, §4.12);
  //   2. chargeAmount persisted in the custody account's currency (chargeCurrency non-null and equal to the
  //      bank/settlement currency the custody account is denominated in) → use it directly;
  //   3. bank mark available → feeNative = feeChf / bank.priceChf — the fee is only persisted in CHF, so its
  //      card-currency native is derived via the SAME mark that values the net settlement leg → amountChf ≈
  //      mark × amount holds on the custody leg by construction;
  //   4. else THROW (fail-loud): a non-zero fee with neither a same-currency chargeAmount nor a mark cannot be
  //      booked mark-consistently; the consumer's failure-isolation retries the row on the next run.
  // No-mark case (bank.amountChf == null, feeNative resolved via ladder 1–2): the composed legs are routed through
  // withFxPlug (F1) — a MIXED CHECKOUT_LTD (needsMark bank/custody ASSET legs + a CHF-valued acquirer-fee leg) is NEVER
  // handed raw to bookTx: its Σ = feeChf ≠ 0 would trip the CHF-imbalance guard in appendRoundingLeg and wedge every
  // later bank_tx head-of-line. Both ASSET legs carry an assetId → resolveLegsOrDefer bridges them with the youngest
  // available mark so the tx balances (needsMark stays true, the mark-to-market job revalues the gross later); the
  // fee-vs-mark valuation residual routes to fx-revaluation. A truly feedless asset (no bridge) defers the row.
  private async checkoutLtdLegs(
    tx: BankTx,
    ctx: BankContext,
    bookingDate: Date,
    marks: LedgerMarkCache,
  ): Promise<LedgerLegInput[]> {
    const bank = this.bankAssetLeg(ctx, +tx.amount, bookingDate, marks, await this.bankAccount(ctx)); // net
    const feeChf = tx.chargeAmountChf ?? 0;
    const netChf = bank.amountChf;
    const legs: LedgerLegInput[] = [bank];

    if (feeChf !== 0) legs.push(this.namedLeg(await this.expense('acquirer-fee'), feeChf));

    // fee native in the settlement (card) currency, resolved via the F2 ladder documented above
    let feeNative: number;
    if (feeChf === 0) {
      feeNative = 0;
    } else if (tx.chargeAmount != null && tx.chargeCurrency != null && tx.chargeCurrency === ctx.currency) {
      // ladder 2: fee persisted in the custody account's currency (ctx.currency, the unit of every native amount on
      // Checkout/{ccy}) — use it directly. The explicit non-null guard keeps a null==null match from smuggling an
      // unverified unit in; a mismatching/unknown fee currency falls through to the mark bridge (ladder 3).
      feeNative = tx.chargeAmount;
    } else if (bank.priceChf != null) {
      feeNative = Util.round(feeChf / bank.priceChf, 8); // ladder 3: CHF fee bridged via the settlement mark
    } else {
      throw new Error(
        `bank_tx ${tx.id} CHECKOUT_LTD: non-zero acquirer fee (${feeChf} CHF) with neither a same-currency ` +
          `chargeAmount nor a mark — the Checkout custody leg cannot be booked mark-consistently`,
      );
    }

    // gross Checkout custody Cr-leg: native gross = net + feeNative (CARD currency, F2 convention); no own *Chf →
    // CHF = net + fee (both CHF-known), else needsMark (Minor R3-5)
    const grossChf = netChf != null ? netChf + feeChf : undefined;
    legs.push({
      account: await this.checkoutAccount(ctx.currency),
      amount: -Util.round(tx.amount + feeNative, 8),
      priceChf: bank.priceChf,
      amountChf: grossChf != null ? -grossChf : undefined,
      needsMark: grossChf == null,
    });

    // F1: route through the shared bridge/plug path — with a historical mark the legs already net to 0 (no plug); a
    // no-historical-mark row bridges the two ASSET legs via getLatestMark so the fee-carrying MIXED tx balances instead
    // of wedging bookTx, and a feedless asset defers cleanly (§4.2a Major B5). The F2 gross convention stays intact:
    // resolveLegsOrDefer only fills the needsMark legs' amountChf (native untouched, needsMark stays true).
    return this.withFxPlug(legs, `bank_tx ${tx.id} checkout_ltd`);
  }

  // §4.2 GSHEET/PENDING DBIT + UNKNOWN: Dr/Cr SUSPENSE ↔ ASSET/bank (both mark, §4.2-Note)
  private async suspenseLegs(
    tx: BankTx,
    ctx: BankContext,
    bookingDate: Date,
    marks: LedgerMarkCache,
    isCredit: boolean,
  ): Promise<LedgerLegInput[]> {
    const bank = this.bankAssetLeg(
      ctx,
      isCredit ? +tx.amount : -tx.amount,
      bookingDate,
      marks,
      await this.bankAccount(ctx),
    );
    const suspenseAccount = await this.accountService.findOrCreate('SUSPENSE', AccountType.SUSPENSE, CHF);
    const suspense: LedgerLegInput = {
      account: suspenseAccount,
      amount: -bank.amount,
      priceChf: bank.priceChf,
      amountChf: bank.amountChf != null ? -bank.amountChf : undefined,
      needsMark: bank.needsMark,
    };

    // §4.2 Frick inline charge: a DEBIT's tx.amount is already gross → the bank leg stays gross; reclassify the charge
    // out of the mirrored SUSPENSE counter into an explicit EXPENSE/bank-fee (a null inline → EXACTLY the prior legs).
    const inline = await this.inlineBankCharge(tx, ctx, bank);
    if (!inline) return [bank, suspense]; // unchanged (incl. the markless needsMark-mirror case)

    suspense.amount = Util.round(suspense.amount - inline.chargeNative, 8); // gross → net (native, account ccy)
    // F1: net the CHF only when the bank leg carries a mark (suspense.amountChf is set iff bank.amountChf is). With no
    // historical mark suspense stays needsMark and — the SUSPENSE account has no assetId to bridge — resolveLegsOrDefer
    // DEFERS the row (fail-closed); force-setting a partial −chargeChf here would book a full-value phantom fx plug.
    if (suspense.amountChf != null) suspense.amountChf = Util.round(suspense.amountChf - inline.chargeChf, 2);
    const legs = [bank, suspense, this.namedLeg(await this.expense('bank-fee'), inline.chargeChf)];
    return this.withFxPlug(legs, `bank_tx ${tx.id} suspense`);
  }

  // --- LEG/ACCOUNT HELPERS --- //

  // the bank ASSET leg native+CHF (mark-consistent). `account` is pre-resolved (ASSET/bank or SUSPENSE/untracked).
  // The mark is resolved via ctx.markAssetId — for a tracked bank that is asset.id, for an UNTRACKED bank a
  // representative same-currency tracked-bank asset id (§4.2a Raiffeisen-untracked variant) so the SUSPENSE leg is
  // EUR-mark-valued and not a needsMark hole that would let withFxPlug create a full-value phantom plug.
  private bankAssetLeg(
    ctx: BankContext,
    signedAmount: number,
    bookingDate: Date,
    marks: LedgerMarkCache,
    account: LedgerAccount,
  ): LedgerLegInput {
    const mark =
      ctx.currency === CHF ? 1 : ctx.markAssetId != null ? marks.getMarkAt(ctx.markAssetId, bookingDate) : undefined;
    const amountChf = mark != null ? Util.round(mark * signedAmount, 2) : undefined;

    return { account, amount: signedAmount, priceChf: mark ?? null, amountChf, needsMark: amountChf == null };
  }

  // CHF-denominated counter leg (LIABILITY/INCOME/EXPENSE): native amount == CHF amount, priceChf = 1
  private namedLeg(account: LedgerAccount, amountChf: number): LedgerLegInput {
    return { account, amount: amountChf, priceChf: 1, amountChf };
  }

  // §4.2 Frick inline charge: a booked DEBIT already carries the bank charge inside tx.amount (gross); the counter/
  // plug must reconcile net of it. Returns the charge to reclassify into an explicit EXPENSE/bank-fee leg, or null
  // when there is no inline charge to book. Fires only for a DEBIT with chargeAmount≠0 AND chargeAmountChf==null
  // (a CHF-priced charge keeps its existing path). Ladder analogous to checkoutLtdLegs: the inline charge is in the
  // account currency, valued via the settlement mark; a missing mark fails loud (fail-closed; Frick assets are mark-fed).
  private async inlineBankCharge(
    tx: BankTx,
    ctx: BankContext,
    bank: LedgerLegInput,
  ): Promise<{ chargeChf: number; chargeNative: number } | null> {
    // a CREDIT arrives net — the charge was deducted upstream and never moves through this account (the financial-log
    // fee metric still counts it as an economic cost; deliberate metric↔ledger asymmetry)
    if (tx.creditDebitIndicator !== BankTxIndicator.DEBIT) return null;
    const chargeNative = tx.chargeAmount ?? 0;
    if (chargeNative === 0 || tx.chargeAmountChf != null) return null;

    // a foreign-currency charge has no same-currency mark to value it against → fail loud (fail-closed)
    if (tx.chargeCurrency !== ctx.currency)
      throw new Error(
        `bank_tx ${tx.id} inline charge (${chargeNative} ${tx.chargeCurrency}) cannot be valued mark-consistently in ${ctx.currency} — no same-currency mark`,
      );

    // F1: value the charge at the SAME mark the bank leg carries. A missing HISTORICAL mark (bank.priceChf == null over
    // the getMarkAt window) is a price-timing gap, not feedless — bridge with the youngest available mark (getLatestMark,
    // the SAME bridge resolveLegsOrDefer applies to the bank-ASSET leg), so the fee-EXPENSE leg stays CHF-consistent and
    // the tx balances instead of throwing PRE-bridge and wedging the head-of-line. Only a truly feedless asset (no latest
    // mark either) fails loud → the row DEFERS (fail-closed), exactly like the charge-less path at the same bookingDate.
    const rate = bank.priceChf ?? (await this.bridgeMark(tx, ctx));
    if (rate == null)
      throw new Error(
        `bank_tx ${tx.id} inline charge (${chargeNative} ${tx.chargeCurrency}) has no mark at the booking date and none ` +
          `in any recent log (feedless) — deferring (retry once the mark feed has the asset)`,
      );

    return { chargeChf: Util.round(rate * chargeNative, 2), chargeNative };
  }

  // F1 — the youngest available bank-currency mark (getLatestMark on ctx.markAssetId, the asset whose FinancialDataLog
  // values the bank leg, §4.2a); the SAME bridge resolveLegsOrDefer applies to the bank-ASSET leg. Used to value an
  // inline charge when the historical mark is missing (a price-timing gap): the fee-EXPENSE leg then stays CHF-consistent
  // with the bridged bank leg (needsMark stays true on the bank leg, the mark-to-market job corrects the basis later).
  // Returns undefined for a feedless asset (no latest mark anywhere) → the caller fails loud.
  private async bridgeMark(tx: BankTx, ctx: BankContext): Promise<number | undefined> {
    const bridge = ctx.markAssetId != null ? await this.markService.getLatestMark(ctx.markAssetId) : undefined;
    if (bridge != null) {
      this.logger.warn(
        `bank_tx ${tx.id} inline charge: no mark at the booking date for asset ${ctx.markAssetId} — bridged the charge ` +
          `with the latest available mark ${bridge} (needsMark stays true on the bank leg; the mark-to-market job corrects the basis)`,
      );
    }
    return bridge;
  }

  // appends an EXPENSE/INCOME fx-revaluation plug for a remaining CHF residual > tolerance (§4.2a); sub-cent →
  // the booking-service ROUNDING leg closes it (no plug created).
  // Major B5: an unmarked non-CHF bank leg is first bridged with the youngest available mark (resolveLegsOrDefer) so a
  // mixed tx (bank-ASSET leg + CHF-anchored liability/expense leg) balances — needsMark stays true, the mark-to-market
  // job corrects the basis later. A truly feedless bank asset (no bridge) defers the row instead of handing an
  // unbalanceable set to bookTx at the fixed historical bookingDate (the §4.2a fix already resolves the EUR mark for
  // untracked banks, so the bridge/defer only fires when the mark is truly absent everywhere).
  private async withFxPlug(legs: LedgerLegInput[], ref: string): Promise<LedgerLegInput[]> {
    if (!(await resolveLegsOrDefer(legs, this.markService, this.logger, ref))) return legs;

    const sumCents = legs.reduce((s, l) => s + Math.round(Util.round(l.amountChf ?? 0, 2) * 100), 0);
    if (Math.abs(sumCents) <= Config.ledger.roundingToleranceCents) return legs;

    const residualChf = Util.round(-sumCents / 100, 2);
    const account = residualChf >= 0 ? await this.income('fx-revaluation') : await this.expense('fx-revaluation');
    legs.push(this.namedLeg(account, residualChf));

    return legs;
  }

  // --- ACCOUNT RESOLUTION --- //

  private async bankAccount(ctx: BankContext): Promise<LedgerAccount> {
    if (ctx.tracked && ctx.asset) {
      const account = await this.accountService.findByAssetId(ctx.asset.id);
      if (!account) throw new Error(`Ledger account for asset ${ctx.asset.id} not found (CoA bootstrap missing)`);
      return account;
    }

    // untracked bank → SUSPENSE/untracked-bank-{name}-{ccy} (§4.2/§1.6 generic rule, not a Raiffeisen hardcode)
    return this.accountService.findOrCreate(
      `SUSPENSE/untracked-bank-${ctx.bankName ?? 'unknown'}-${ctx.currency}`,
      AccountType.SUSPENSE,
      ctx.currency,
    );
  }

  private async checkoutAccount(currency: string): Promise<LedgerAccount> {
    // Checkout custody asset account (id 270/271/311 exist as asset rows, §1.1); resolved by name
    const account = await this.accountService.findByName(`Checkout/${currency}`);
    if (!account) throw new Error(`Ledger account Checkout/${currency} not found (CoA bootstrap missing)`);
    return account;
  }

  private liability(qualifier: string): Promise<LedgerAccount> {
    return this.accountService.findOrCreate(`LIABILITY/${qualifier}`, AccountType.LIABILITY, CHF);
  }

  private expense(qualifier: string): Promise<LedgerAccount> {
    return this.accountService.findOrCreate(`EXPENSE/${qualifier}`, AccountType.EXPENSE, CHF);
  }

  private income(qualifier: string): Promise<LedgerAccount> {
    return this.accountService.findOrCreate(`INCOME/${qualifier}`, AccountType.INCOME, CHF);
  }

  // resolves the per accountIban bank → asset/currency/tracked state (§4.2/§1.6 generic untracked-bank rule)
  private async bankContext(tx: BankTx): Promise<BankContext> {
    if (tx.accountIban) {
      const bank = await this.bankRepo.findOne({ where: { iban: tx.accountIban }, relations: { asset: true } });
      if (bank) {
        const tracked = bank.asset != null;
        return {
          asset: bank.asset,
          currency: bank.currency,
          bankName: bank.name,
          tracked,
          // tracked → mark via its own asset; untracked → a representative same-currency tracked-bank asset (§4.2a)
          markAssetId: tracked ? bank.asset.id : await this.currencyMarkAssetId(bank.currency),
        };
      }
    }

    const currency = tx.currency ?? CHF; // no bank match → untracked, currency from the tx
    return {
      asset: undefined,
      currency,
      bankName: tx.bankName ?? 'unknown',
      tracked: false,
      markAssetId: await this.currencyMarkAssetId(currency), // §4.2a: value the SUSPENSE leg with the currency mark
    };
  }

  // a representative tracked-bank asset id for `currency` whose FinancialDataLog mark values an UNTRACKED-bank leg
  // (§4.2a Raiffeisen-untracked variant). The EUR mark is identical across all EUR bank assets, so any tracked bank
  // of the same currency supplies it; CHF needs no mark (priceChf=1). Returns undefined when no tracked bank of that
  // currency exists → the leg stays needsMark and withFxPlug books no silent plug (§5.1 stage 3).
  private async currencyMarkAssetId(currency: string): Promise<number | undefined> {
    if (currency === CHF) return undefined; // CHF leg is valued 1:1, no mark lookup needed

    const trackedBank = await this.bankRepo.findOne({
      where: { currency, asset: { id: Not(IsNull()) } },
      relations: { asset: true },
      order: { id: 'ASC' }, // deterministic representative pick
    });

    return trackedBank?.asset?.id;
  }
}
