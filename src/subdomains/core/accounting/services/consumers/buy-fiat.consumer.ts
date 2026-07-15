import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Config } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { MoreThan, Repository } from 'typeorm';
import { AccountType, LedgerAccount } from '../../entities/ledger-account.entity';
import { LedgerLeg } from '../../entities/ledger-leg.entity';
import { LedgerTx } from '../../entities/ledger-tx.entity';
import { LedgerAccountService } from '../ledger-account.service';
import { LedgerBookingService, LedgerLegInput, LedgerTxInput } from '../ledger-booking.service';
import { LedgerMarkCache, LedgerMarkService } from '../ledger-mark.service';
import { getLedgerWatermark, runContentChangeScan, setLedgerWatermark } from './ledger-watermark.helper';

const SOURCE_TYPE = 'buy_fiat';
const CRYPTO_INPUT_SOURCE = 'crypto_input';
const CUTOVER_SOURCE = 'cutover';
const CUTOVER_LOG_ID_KEY = 'ledgerCutoverLogId';
const CUTOVER_SNAPSHOT_DATE_KEY = 'ledgerCutoverSnapshotDate';
const CHF = 'CHF';
const PAYMENT_LINK = 'LIABILITY/paymentLink';
const BUY_FIAT_OWED = 'LIABILITY/buyFiat-owed';

/**
 * The Class-1 core consumer (§4.7 + §4.7a + §4.7b, D04 §2 / D13 C). Pure observer: reads buy_fiat (+ ledger_tx
 * for the seq0/opening gate), writes only ledger_*.
 *
 * It does NOT book the crypto-input leg (CryptoInput consumer is the single booker, §4.1). Two settlement paths,
 * chosen by `cryptoInput.paymentLinkPayment IS NOT NULL`:
 *  (I) regular sell — fee + received→owed reclassification → TRANSIT (Class-1 hold) → bank-ASSET (+FX residual);
 * (II) paymentLink merchant payout (§4.7b) — clears LIABILITY/paymentLink via fee + transmit/booked split.
 * The owed/paymentLink liability holds until the bank bookingDate (Class-1, reproduces #3871 by construction).
 */
@Injectable()
export class BuyFiatConsumer {
  private readonly logger = new DfxLogger(BuyFiatConsumer);

  constructor(
    private readonly settingService: SettingService,
    private readonly bookingService: LedgerBookingService,
    private readonly accountService: LedgerAccountService,
    private readonly markService: LedgerMarkService,
    @InjectRepository(BuyFiat) private readonly buyFiatRepo: Repository<BuyFiat>,
    @InjectRepository(LedgerTx) private readonly ledgerTxRepo: Repository<LedgerTx>,
  ) {}

  async process(): Promise<void> {
    const watermark = (await getLedgerWatermark(this.settingService, SOURCE_TYPE)) ?? {
      lastProcessedId: 0,
      lastReversalScan: new Date(0),
    };

    await this.processForward(watermark);

    // content-change scan (§4.12 / §6.3): catches late-settling cutover-straddling rows (id <= watermark, settlement
    // set post-cutover) the forward id-scan skips — runs ALSO when the forward batch is empty. The booker is
    // idempotent (per-seq alreadyBooked), so a row in both scans is booked once. Re-read the watermark in case the
    // forward batch advanced lastProcessedId above.
    const afterForward = (await getLedgerWatermark(this.settingService, SOURCE_TYPE)) ?? watermark;
    await runContentChangeScan(
      this.settingService,
      SOURCE_TYPE,
      afterForward,
      this.buyFiatRepo,
      { cryptoInput: { paymentLinkPayment: true }, fiatOutput: { bankTx: true, bank: { asset: true } } },
      async (bf: BuyFiat) => {
        const marks = await this.preloadMarks([bf]);

        // forward book() FIRST: append any newly-settled seqs / forward-book a late-settling row. A gate-blocked run
        // returns false → distinguish a pre-cutover-settled row (value in the aggregate opening, C2) → SKIP+advance,
        // from a genuinely post-cutover row whose received/paymentLink opening is not yet booked → THROW (cursor stays
        // put, retry). Returning here for a gate-blocked row ALSO avoids resolving+creating the value-coupled accounts
        // below for a never-booked row (no phantom owed/transit/bank accounts).
        if (!(await this.book(bf, marks))) {
          if (await this.preCutoverSettled(bf)) return;
          throw new Error(`buy_fiat ${bf.id} content-change scan gate-blocked — retry next run (§4.7 G-a)`);
        }

        // then §4.12 + M3 + M4: on a content change, reverse+rebook the value-coupled regular-sell chain (reclassification
        // seq1 / transmit seq2 / settlement seq3 all carry owedChf). Reversing ONLY seq1 while seq2/seq3 are booked leaves
        // owed on the OLD value and it never closes to 0 (Liability-Schliessung bricht) — the chain method reverses the
        // whole ACTIVE chain atomically and no-ops when nothing changed (incl. the seqs book() just booked). Gated on
        // outputAmount != null (M4: an unpriced row is "not yet settled", not an error → no seq1 to reverse). Skipped for
        // owed-straddling rows (reclassification anchored in the cutover opening) and the paymentLink path (own seq chain).
        const owedOpeningChf = await this.cutoverOwedOpeningChf(bf.id);
        if (owedOpeningChf == null && !bf.cryptoInput?.paymentLinkPayment && bf.outputAmount != null) {
          const chain = (
            await Promise.all([
              this.buildReclassificationSeq1(bf),
              this.buildTransmitSeq2(bf, owedOpeningChf),
              this.buildSettlementSeq3(bf, marks, owedOpeningChf),
            ])
          ).filter((i): i is LedgerTxInput => i != null);
          if (chain.length) await this.bookingService.reverseAndRebookChainIfChanged(chain);
        }
      },
    );
  }

  private async processForward(watermark: { lastProcessedId: number; lastReversalScan: Date }): Promise<void> {
    const batch = await this.buyFiatRepo.find({
      where: { id: MoreThan(watermark.lastProcessedId) },
      relations: { cryptoInput: { paymentLinkPayment: true }, fiatOutput: { bankTx: true, bank: { asset: true } } },
      order: { id: 'ASC' },
      take: Config.ledger.backfillBatchSize,
    });
    if (!batch.length) return;

    const marks = await this.preloadMarks(batch);

    let lastProcessedId = watermark.lastProcessedId;
    for (const bf of batch) {
      try {
        const advance = await this.book(bf, marks);
        // a gate-blocked seq1 must NOT advance the watermark past this row (retry next run, §4.7 G-a)
        if (!advance) break;
        lastProcessedId = bf.id;
      } catch (e) {
        this.logger.error(`Failed to book buy_fiat ${bf.id}:`, e);
        break; // failure-isolation: leave watermark unchanged, retry next run (§4-header)
      }
    }

    if (lastProcessedId > watermark.lastProcessedId) {
      await setLedgerWatermark(this.settingService, SOURCE_TYPE, { ...watermark, lastProcessedId });
    }
  }

  private async preloadMarks(batch: BuyFiat[]): Promise<LedgerMarkCache> {
    const dates = batch.flatMap((bf) => [bf.updated, bf.fiatOutput?.bankTx?.bookingDate].filter((d): d is Date => !!d));
    const times = dates.map((d) => d.getTime());
    // lookback so getMarkAt finds the latest mark at-or-before the earliest row timestamp
    return this.markService.preload(Util.daysBefore(2, new Date(Math.min(...times))), new Date(Math.max(...times)));
  }

  // returns false when seq1 is gate-blocked (received/paymentLink not yet opened) → caller stops advancing
  private async book(bf: BuyFiat, marks: LedgerMarkCache): Promise<boolean> {
    return bf.cryptoInput?.paymentLinkPayment ? this.bookPaymentLink(bf, marks) : this.bookRegular(bf, marks);
  }

  // --- (I) REGULAR SELL (§4.7 / §4.7a) --- //

  private async bookRegular(bf: BuyFiat, marks: LedgerMarkCache): Promise<boolean> {
    // §4.7a/§6.1 owed-straddling: a pre-cutover open buy_fiat (outputAmount set) had its received→owed reclassification
    // run BEFORE the cutover; the cutover re-opened owed via the per-row marker `<logId>:buy_fiat-owed:<id>`. There is
    // no seq1 chain from this run → the seq1 gate (received seq0) would NEVER open and block seq2/seq3 forever
    // (Blocker R6-1). Detect the owed-opening marker and skip seq1; seq2/seq3 settle owed (opening-CHF anchor) to 0.
    const owedOpeningChf = await this.cutoverOwedOpeningChf(bf.id);

    // seq1 (fee + reclassification) — only once outputAmount is set AND received is opened (gate G-a/G-b).
    // Skipped entirely for owed-straddling rows (reclassification already booked pre-cutover, anchored in the opening).
    if (owedOpeningChf == null && bf.outputAmount != null && !(await this.alreadyBooked(bf.id, 1))) {
      if (!(await this.receivedOpened(bf))) return false;
      await this.bookReclassification(bf);
    }

    // seq2 (transmit, Class-1 hold) — on fiatOutput.isTransmittedDate
    if (bf.fiatOutput?.isTransmittedDate && !(await this.alreadyBooked(bf.id, 2))) {
      await this.bookTransmit(bf, owedOpeningChf);
    }

    // seq3 (booked) — on complete() (= fiatOutput.bankTx booked), at bank_tx.bookingDate
    if (bf.fiatOutput?.bankTx && !(await this.alreadyBooked(bf.id, 3))) {
      await this.bookSettlement(bf, marks, owedOpeningChf);
    }

    return true;
  }

  // §4.7 seq1 — 4-leg: (a) Dr received +fee / Cr INCOME/fee-buyFiat −fee; (b) Dr received +(amountInChf−fee) /
  // Cr buyFiat-owed −(amountInChf−fee). After seq1 received = 0, owed = −(amountInChf−fee).
  private async bookReclassification(bf: BuyFiat): Promise<void> {
    const input = await this.buildReclassificationSeq1(bf);
    if (input) await this.bookingService.bookTx(input);
  }

  // builds the seq1 reclassification LedgerTxInput for the REGULAR sell path (undefined for paymentLink / no anchor)
  private async buildReclassificationSeq1(bf: BuyFiat): Promise<LedgerTxInput | undefined> {
    if (bf.cryptoInput?.paymentLinkPayment) return undefined; // paymentLink path has its own seq1 (venue spread)
    if (bf.amountInChf == null) throw new Error(`buy_fiat ${bf.id} has outputAmount but amountInChf is null`);

    const fee = bf.totalFeeAmountChf ?? 0; // additive null-strategy (§5.1)
    const reclassChf = Util.round(bf.amountInChf - fee, 2);

    const received = await this.liability('buyFiat-received');
    const owed = await this.liability('buyFiat-owed');
    const feeIncome = await this.income('fee-buyFiat');

    return {
      sourceType: SOURCE_TYPE,
      sourceId: `${bf.id}`,
      seq: 1,
      bookingDate: bf.cryptoInput.updated,
      valueDate: bf.cryptoInput.updated,
      legs: [
        this.chfLeg(received, fee),
        this.chfLeg(feeIncome, -fee),
        this.chfLeg(received, reclassChf),
        this.chfLeg(owed, -reclassChf),
      ],
    };
  }

  // §4.7 seq2 — transmit: Dr buyFiat-owed +owed_chf / Cr TRANSIT/payout/{ccy} −owed_chf (Class-1 hold).
  // For an owed-straddling row owedOpeningChf is the cutover opening-CHF anchor (§4.7a/§6.1), so the owed-Dr debits
  // the exact value the opening Cr leg credited → owed closes cent-exact to 0.
  private async bookTransmit(bf: BuyFiat, owedOpeningChf?: number): Promise<void> {
    const input = await this.buildTransmitSeq2(bf, owedOpeningChf);
    if (input) await this.bookingService.bookTx(input);
  }

  // builds the seq2 transmit LedgerTxInput for the REGULAR sell path, or undefined when not yet transmitted (no chain
  // link). owedChf is the value-coupled anchor (reclassification CHF, or the cutover opening-CHF for a straddling row).
  private async buildTransmitSeq2(bf: BuyFiat, owedOpeningChf?: number): Promise<LedgerTxInput | undefined> {
    if (!bf.fiatOutput?.isTransmittedDate) return undefined;

    const owedChf = this.owedChf(bf, owedOpeningChf);
    const owed = await this.liability('buyFiat-owed');
    const transit = await this.transit(this.outputCurrency(bf));

    return {
      sourceType: SOURCE_TYPE,
      sourceId: `${bf.id}`,
      seq: 2,
      bookingDate: bf.fiatOutput.isTransmittedDate,
      valueDate: bf.fiatOutput.isTransmittedDate,
      legs: [this.chfLeg(owed, owedChf), this.chfLeg(transit, -owedChf)],
    };
  }

  // §4.7 seq3 — booked: Dr TRANSIT/payout +owed_chf / Cr ASSET/bank −(outputAmount × mark) (+ §4.7a FX-P&L leg
  // for non-CHF output). Settlement = bank_tx.bookingDate (NOT isTransmittedDate — Class 1).
  private async bookSettlement(bf: BuyFiat, marks: LedgerMarkCache, owedOpeningChf?: number): Promise<void> {
    const input = await this.buildSettlementSeq3(bf, marks, owedOpeningChf);
    if (input) await this.bookingService.bookTx(input);
  }

  // builds the seq3 settlement LedgerTxInput (regular + paymentLink share it), or undefined when the bank_tx is not yet
  // booked (no chain link). owedChf is the value-coupled anchor (reclassification CHF / cutover opening / paymentLink).
  private async buildSettlementSeq3(
    bf: BuyFiat,
    marks: LedgerMarkCache,
    owedOpeningChf?: number,
  ): Promise<LedgerTxInput | undefined> {
    if (!bf.fiatOutput?.bankTx) return undefined;

    const bookingDate = bf.fiatOutput.bankTx.bookingDate ?? bf.fiatOutput.bankTx.created;
    const owedChf = this.owedChf(bf, owedOpeningChf);

    const transit = await this.transit(this.outputCurrency(bf));
    const bankLeg = await this.bankCrLeg(bf, bookingDate, marks);

    // §4.7a FX-P&L leg = −(Σ CHF) → INCOME/EXPENSE fx-revaluation (EUR drift between reclassification and booking)
    const legs: LedgerLegInput[] = [this.chfLeg(transit, owedChf), bankLeg];
    await this.appendFxResidual(legs);

    return {
      sourceType: SOURCE_TYPE,
      sourceId: `${bf.id}`,
      seq: 3,
      bookingDate,
      valueDate: bf.fiatOutput.bankTx.valueDate ?? bookingDate,
      legs,
    };
  }

  // --- (II) PAYMENTLINK MERCHANT PAYOUT (§4.7b) --- //

  private async bookPaymentLink(bf: BuyFiat, marks: LedgerMarkCache): Promise<boolean> {
    // seq1 (fee realization + venue-spread plug) — once outputAmount set AND the seq0 paymentLink opening exists
    if (bf.outputAmount != null && !(await this.alreadyBooked(bf.id, 1))) {
      const opening = await this.paymentLinkOpeningChf(bf);
      if (opening == null) return false; // gate: CryptoInput consumer has not opened paymentLink yet (§4.7b)
      await this.bookPaymentLinkFee(bf, opening);
    }

    if (bf.fiatOutput?.isTransmittedDate && !(await this.alreadyBooked(bf.id, 2))) {
      await this.bookPaymentLinkTransmit(bf);
    }

    if (bf.fiatOutput?.bankTx && !(await this.alreadyBooked(bf.id, 3))) {
      await this.bookSettlement(bf, marks); // identical Class-1 transmit/booked split as the regular path
    }

    return true;
  }

  /**
   * §4.7b seq1 — debits LIABILITY/paymentLink down to exactly −outputAmount_chf. The (totalFeeAmountChf +
   * paymentLinkFeeAmount_chf) portion is realized as INCOME/fee-paymentLink (BOTH DFX fee shares, Minor R9-5);
   * the remaining venue-sell-spread (opening Mark×amount − outputAmount_chf − fee) goes into the fx-revaluation
   * plug — NOT INCOME (it is FX/valuation drift, §1.11/§7.6).
   */
  private async bookPaymentLinkFee(bf: BuyFiat, openingChf: number): Promise<void> {
    const totalFee = bf.totalFeeAmountChf ?? 0;
    // paymentLinkFeeAmount is NOT a persisted column (local var in setPaymentLinkPayment buy-fiat.entity.ts:392);
    // reconstruct as outputReferenceAmount − outputAmount (both persisted :199/:206), the closing-consistent value
    const plFeeNative = Util.round((bf.outputReferenceAmount ?? 0) - (bf.outputAmount ?? 0), 8);
    const plFeeChf = Util.round(plFeeNative * this.owedReferenceRate(bf), 2);
    const feeChf = Util.round(totalFee + plFeeChf, 2);

    const outputChf = this.owedChf(bf); // outputAmount × reclassification-mark
    const venueSpread = Util.round(openingChf - outputChf - feeChf, 2); // the real crypto↔fiat sell-spread

    const paymentLink = await this.paymentLinkAccount();
    const feeIncome = await this.income('fee-paymentLink');

    const legs: LedgerLegInput[] = [
      this.chfLeg(paymentLink, feeChf), // Dr paymentLink +fee
      this.chfLeg(feeIncome, -feeChf), //  Cr INCOME/fee-paymentLink −fee
    ];
    if (venueSpread !== 0) {
      legs.push(this.chfLeg(paymentLink, venueSpread)); // Dr paymentLink +venueSpread → reaches −outputChf
      const fx = venueSpread >= 0 ? await this.income('fx-revaluation') : await this.expense('fx-revaluation');
      legs.push(this.chfLeg(fx, -venueSpread));
    }

    await this.bookingService.bookTx({
      sourceType: SOURCE_TYPE,
      sourceId: `${bf.id}`,
      seq: 1,
      bookingDate: bf.cryptoInput.updated,
      valueDate: bf.cryptoInput.updated,
      legs,
    });
  }

  // §4.7b seq2 — transmit: Dr paymentLink +outputAmount_chf / Cr TRANSIT/payout/{ccy} → paymentLink reaches 0
  private async bookPaymentLinkTransmit(bf: BuyFiat): Promise<void> {
    const outputChf = this.owedChf(bf);
    const paymentLink = await this.paymentLinkAccount();
    const transit = await this.transit(this.outputCurrency(bf));

    await this.bookingService.bookTx({
      sourceType: SOURCE_TYPE,
      sourceId: `${bf.id}`,
      seq: 2,
      bookingDate: bf.fiatOutput.isTransmittedDate,
      valueDate: bf.fiatOutput.isTransmittedDate,
      legs: [this.chfLeg(paymentLink, outputChf), this.chfLeg(transit, -outputChf)],
    });
  }

  // --- SHARED HELPERS --- //

  // the bank-ASSET Cr leg of seq3: −outputAmount native, CHF = mark × outputAmount (mark-consistent, §7)
  private async bankCrLeg(bf: BuyFiat, bookingDate: Date, marks: LedgerMarkCache): Promise<LedgerLegInput> {
    const bankAsset = bf.fiatOutput?.bank?.asset;
    if (!bankAsset) throw new Error(`buy_fiat ${bf.id} fiatOutput has no bank.asset (untracked output bank)`);
    const account = await this.assetAccount(bankAsset.id);

    const outputAmount = bf.outputAmount ?? 0;
    const mark = this.outputMark(bf, bookingDate, marks);
    const chf = mark != null ? Util.round(mark * outputAmount, 2) : undefined;

    return {
      account,
      amount: -outputAmount,
      priceChf: mark ?? null,
      amountChf: chf != null ? -chf : undefined,
      needsMark: chf == null,
    };
  }

  // §4.7a — appends the FX-P&L leg = −(Σ CHF) for the EUR/output drift; CHF output → drift 0 → no leg.
  // No silent plug while a leg still needsMark (§5.1 stage 3): an unmarked leg carries amountChf=undefined (counted
  // as 0), so plugging would book its full value as a phantom fx-revaluation — leave it for the mark-to-market job to
  // revalue, consistent with exchange-tx.consumer.ts.
  private async appendFxResidual(legs: LedgerLegInput[]): Promise<void> {
    if (legs.some((l) => l.needsMark)) return;

    const sumCents = legs.reduce((s, l) => s + Math.round(Util.round(l.amountChf ?? 0, 2) * 100), 0);
    if (Math.abs(sumCents) <= Config.ledger.roundingToleranceCents) return; // sub-cent → ROUNDING

    const residualChf = Util.round(-sumCents / 100, 2);
    const account = residualChf >= 0 ? await this.income('fx-revaluation') : await this.expense('fx-revaluation');
    legs.push(this.chfLeg(account, residualChf));
  }

  // owed_chf = the reclassification CHF (amountInChf − totalFeeAmountChf), the value seq1 credited to owed.
  // For paymentLink it is the net merchant fiat output_chf = outputAmount × reclassification-mark.
  // For an owed-straddling row (§4.7a/§6.1) it is the cutover opening-CHF anchor (= −leg.amountChf of the opening),
  // so transmit/booked debit owed by exactly the opening value → owed closes cent-exact to 0 and the mark drift
  // Opening↔Settlement lands in the §4.7a FX-P&L leg (appendFxResidual), not as a phantom on owed (Blocker R6-1).
  private owedChf(bf: BuyFiat, owedOpeningChf?: number): number {
    if (owedOpeningChf != null) return owedOpeningChf;
    if (bf.cryptoInput?.paymentLinkPayment) return Util.round((bf.outputAmount ?? 0) * this.owedReferenceRate(bf), 2);
    return Util.round((bf.amountInChf ?? 0) - (bf.totalFeeAmountChf ?? 0), 2);
  }

  // CHF-per-output-unit at the reclassification mark, derived from the persisted reference (outputReferenceAmount
  // is the fiat reference, amountInChf its CHF value) — a deterministic ratio, NOT a market mark lookup
  private owedReferenceRate(bf: BuyFiat): number {
    const ref = bf.outputReferenceAmount;
    if (ref == null || ref === 0 || bf.amountInChf == null) {
      // CHF output has a 1:1 rate that needs no reference; a non-CHF output without one cannot be valued — fail loud
      // rather than silently returning 0, which would zero owedChf/plFeeChf and misclassify the whole value into the
      // fx-revaluation plug (§5.1 no silent fallback).
      if (this.outputCurrency(bf) === CHF) return 1;
      throw new Error(
        `buy_fiat ${bf.id} owedReferenceRate: missing outputReferenceAmount/amountInChf for non-CHF output ${this.outputCurrency(
          bf,
        )} — refusing a 0-fallback that would misclassify the value into the fx-revaluation plug`,
      );
    }
    return Util.round(bf.amountInChf / ref, 8);
  }

  // the output-currency mark for the bank-ASSET leg: CHF → 1, else getMarkAt(bank.asset, bookingDate)
  private outputMark(bf: BuyFiat, bookingDate: Date, marks: LedgerMarkCache): number | undefined {
    if (this.outputCurrency(bf) === CHF) return 1;
    const bankAssetId = bf.fiatOutput?.bank?.asset?.id;
    return bankAssetId != null ? marks.getMarkAt(bankAssetId, bookingDate) : undefined;
  }

  private outputCurrency(bf: BuyFiat): string {
    return bf.outputAsset?.name ?? bf.fiatOutput?.currency ?? CHF;
  }

  // --- GATE (§4.7 G-a/G-b) --- //

  // received is opened by the seq0 CryptoInput ledger_tx (G-a) or the cutover opening (G-b, cutover-straddling)
  private async receivedOpened(bf: BuyFiat): Promise<boolean> {
    const cryptoInputId = bf.cryptoInput?.id;
    if (cryptoInputId != null) {
      const ga = await this.ledgerTxRepo.countBy({
        sourceType: CRYPTO_INPUT_SOURCE,
        sourceId: `${cryptoInputId}`,
        seq: 0,
      });
      if (ga > 0) return true; // G-a
    }

    // G-b: cutover opening on buyFiat-received for this buy_fiat.id (synthetic seq0 marker, §6.1). The cutover
    // writes `${snapshotLogId}:buy_fiat:${id}`, so the prefix must be resolved from ledgerCutoverLogId — an exact
    // `:buy_fiat:${id}` match would NEVER hit (the snapshot logId prefix is missing → G-b dead, Blocker R4-2).
    const cutoverSourceId = await this.cutoverReceivedSourceId(bf.id);
    if (cutoverSourceId == null) return false; // cutover not run yet → no opening to match
    const gb = await this.ledgerTxRepo.countBy({ sourceType: CUTOVER_SOURCE, sourceId: cutoverSourceId });
    return gb > 0;
  }

  // the full cutover per-row received marker sourceId (§6.1 / §4.7 G-b): `${snapshotLogId}:buy_fiat:${id}`.
  // The prefix is the snapshot logId, persisted in ledgerCutoverLogId by the cutover (§6.3 step 5).
  private async cutoverReceivedSourceId(buyFiatId: number): Promise<string | undefined> {
    const cutoverLogId = await this.settingService.get(CUTOVER_LOG_ID_KEY);
    return cutoverLogId != null ? `${cutoverLogId}:buy_fiat:${buyFiatId}` : undefined;
  }

  // C2: true iff this row's settlement (outputDate, the immutable completion timestamp) is at/before the cutover
  // snapshot → its value is already in the aggregate opening, NEVER a per-row cutover marker (the cutover opens ONLY
  // rows still OPEN at the snapshot, whose outputDate is null or > snapshot). The content-change scan uses it to
  // SKIP+advance a forever-gate-blocked pre-cutover-settled row instead of throwing (which would wedge the scan). The
  // "no marker" half of §6.1 is implied — being gate-blocked already means neither a G-a seq0 nor a G-b/owed/paymentLink
  // opening was found for this row.
  private async preCutoverSettled(bf: BuyFiat): Promise<boolean> {
    if (bf.outputDate == null) return false;

    const iso = await this.settingService.get(CUTOVER_SNAPSHOT_DATE_KEY);
    return iso != null && bf.outputDate <= new Date(iso);
  }

  // §4.7a/§6.1 — looks up the cutover per-row owed-opening leg CHF (marker `${snapshotLogId}:buy_fiat-owed:${id}`);
  // the prefix is the snapshot logId persisted in ledgerCutoverLogId. Returns undefined for a regular post-cutover
  // row (no owed opening). Mirrors bank-tx.consumer.ts cutoverOwedOpeningChf (Major R6-1).
  private async cutoverOwedOpeningChf(buyFiatId: number): Promise<number | undefined> {
    const cutoverLogId = await this.settingService.get(CUTOVER_LOG_ID_KEY);
    if (cutoverLogId == null) return undefined;

    const opening = await this.ledgerTxRepo.findOne({
      where: { sourceType: CUTOVER_SOURCE, sourceId: `${cutoverLogId}:buy_fiat-owed:${buyFiatId}` },
      relations: { legs: { account: true } },
    });
    const leg = opening?.legs?.find((l: LedgerLeg) => l.account?.name === BUY_FIAT_OWED);
    if (leg?.amountChf == null) return undefined;

    return Util.round(-leg.amountChf, 2); // the opening Cr leg is −openingChf → owed-Dr debits +openingChf
  }

  // §4.7b gate — returns the seq0 paymentLink opening CHF (= −leg.amountChf) or undefined if not yet opened
  private async paymentLinkOpeningChf(bf: BuyFiat): Promise<number | undefined> {
    const cryptoInputId = bf.cryptoInput?.id;
    if (cryptoInputId == null) return undefined;

    const seq0 = await this.ledgerTxRepo.findOne({
      where: { sourceType: CRYPTO_INPUT_SOURCE, sourceId: `${cryptoInputId}`, seq: 0 },
      relations: { legs: { account: true } },
    });
    const leg = seq0?.legs?.find((l: LedgerLeg) => l.account?.name === PAYMENT_LINK);
    if (leg?.amountChf == null) return undefined;

    return Util.round(-leg.amountChf, 2); // seq0 Cr leg is −Mark×amount → opening value is its absolute CHF
  }

  // --- ACCOUNT/LEG HELPERS --- //

  private chfLeg(account: LedgerAccount, amountChf: number): LedgerLegInput {
    return { account, amount: amountChf, priceChf: 1, amountChf };
  }

  // §4.12 (R3): a seq is "already booked" iff an ACTIVE (not reversed-without-rebook) tx exists AT this seq — NOT
  // `nextSeq > seq`. After a content-change reversal of seq1 (reversal seq=N, re-book seq=N+1) MAX(seq) jumps past
  // 2/3, so `nextSeq > 2/3` would wrongly report transmit/booked as booked and they would never run → buyFiat-owed
  // never closes. hasActiveTxAt walks the reversal chain of the ORIGINAL at this exact seq.
  private async alreadyBooked(id: number, seq: number): Promise<boolean> {
    return this.bookingService.hasActiveTxAt(SOURCE_TYPE, `${id}`, seq);
  }

  private async assetAccount(assetId: number): Promise<LedgerAccount> {
    const account = await this.accountService.findByAssetId(assetId);
    if (!account) throw new Error(`ledger account for asset ${assetId} not found (CoA bootstrap missing)`);
    return account;
  }

  private transit(currency: string): Promise<LedgerAccount> {
    return this.accountService.findOrCreate(`TRANSIT/payout/${currency}`, AccountType.TRANSIT, currency);
  }

  private paymentLinkAccount(): Promise<LedgerAccount> {
    return this.accountService.findOrCreate(PAYMENT_LINK, AccountType.LIABILITY, CHF);
  }

  private liability(qualifier: string): Promise<LedgerAccount> {
    return this.accountService.findOrCreate(`LIABILITY/${qualifier}`, AccountType.LIABILITY, CHF);
  }

  private income(qualifier: string): Promise<LedgerAccount> {
    return this.accountService.findOrCreate(`INCOME/${qualifier}`, AccountType.INCOME, CHF);
  }

  private expense(qualifier: string): Promise<LedgerAccount> {
    return this.accountService.findOrCreate(`EXPENSE/${qualifier}`, AccountType.EXPENSE, CHF);
  }
}
