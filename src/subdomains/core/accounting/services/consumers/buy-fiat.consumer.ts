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
import { LedgerBookingService, LedgerLegInput } from '../ledger-booking.service';
import { LedgerMarkCache, LedgerMarkService } from '../ledger-mark.service';
import { getLedgerWatermark, setLedgerWatermark } from './ledger-watermark.helper';

const SOURCE_TYPE = 'buy_fiat';
const CRYPTO_INPUT_SOURCE = 'crypto_input';
const CUTOVER_SOURCE = 'cutover';
const CHF = 'CHF';
const PAYMENT_LINK = 'LIABILITY/paymentLink';

/**
 * The Class-1-Kern consumer (§4.7 + §4.7a + §4.7b, D04 §2 / D13 C). Pure observer: reads buy_fiat (+ ledger_tx
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

    const batch = await this.buyFiatRepo.find({
      where: { id: MoreThan(watermark.lastProcessedId) },
      relations: { cryptoInput: { paymentLinkPayment: true }, fiatOutput: { bankTx: true } },
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
        this.logger.error(`Failed to book buy_fiat ${bf.id}`, e);
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
    return this.markService.preload(new Date(Math.min(...times)), new Date(Math.max(...times)));
  }

  // returns false when seq1 is gate-blocked (received/paymentLink not yet opened) → caller stops advancing
  private async book(bf: BuyFiat, marks: LedgerMarkCache): Promise<boolean> {
    return bf.cryptoInput?.paymentLinkPayment ? this.bookPaymentLink(bf, marks) : this.bookRegular(bf, marks);
  }

  // === (I) REGULAR SELL (§4.7 / §4.7a) === //

  private async bookRegular(bf: BuyFiat, marks: LedgerMarkCache): Promise<boolean> {
    // seq1 (fee + reclassification) — only once outputAmount is set AND received is opened (gate G-a/G-b)
    if (bf.outputAmount != null && !(await this.alreadyBooked(bf.id, 1))) {
      if (!(await this.receivedOpened(bf))) return false;
      await this.bookReclassification(bf);
    }

    // seq2 (transmit, Class-1 hold) — on fiatOutput.isTransmittedDate
    if (bf.fiatOutput?.isTransmittedDate && !(await this.alreadyBooked(bf.id, 2))) {
      await this.bookTransmit(bf);
    }

    // seq3 (booked) — on complete() (= fiatOutput.bankTx booked), at bank_tx.bookingDate
    if (bf.fiatOutput?.bankTx && !(await this.alreadyBooked(bf.id, 3))) {
      await this.bookSettlement(bf, marks);
    }

    return true;
  }

  // §4.7 seq1 — 4-leg: (a) Dr received +fee / Cr INCOME/fee-buyFiat −fee; (b) Dr received +(amountInChf−fee) /
  // Cr buyFiat-owed −(amountInChf−fee). After seq1 received = 0, owed = −(amountInChf−fee).
  private async bookReclassification(bf: BuyFiat): Promise<void> {
    if (bf.amountInChf == null) throw new Error(`buy_fiat ${bf.id} has outputAmount but amountInChf is null`);

    const fee = bf.totalFeeAmountChf ?? 0; // additive null-strategy (§5.1)
    const reclassChf = Util.round(bf.amountInChf - fee, 2);

    const received = await this.liability('buyFiat-received');
    const owed = await this.liability('buyFiat-owed');
    const feeIncome = await this.income('fee-buyFiat');

    await this.bookingService.bookTx({
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
    });
  }

  // §4.7 seq2 — transmit: Dr buyFiat-owed +owed_chf / Cr TRANSIT/payout/{ccy} −owed_chf (Class-1 hold)
  private async bookTransmit(bf: BuyFiat): Promise<void> {
    const owedChf = this.owedChf(bf);
    const owed = await this.liability('buyFiat-owed');
    const transit = await this.transit(this.outputCurrency(bf));

    await this.bookingService.bookTx({
      sourceType: SOURCE_TYPE,
      sourceId: `${bf.id}`,
      seq: 2,
      bookingDate: bf.fiatOutput.isTransmittedDate,
      valueDate: bf.fiatOutput.isTransmittedDate,
      legs: [this.chfLeg(owed, owedChf), this.chfLeg(transit, -owedChf)],
    });
  }

  // §4.7 seq3 — booked: Dr TRANSIT/payout +owed_chf / Cr ASSET/bank −(outputAmount × mark) (+ §4.7a FX-P&L leg
  // for non-CHF output). Settlement = bank_tx.bookingDate (NOT isTransmittedDate — Class 1).
  private async bookSettlement(bf: BuyFiat, marks: LedgerMarkCache): Promise<void> {
    const bookingDate = bf.fiatOutput.bankTx.bookingDate ?? bf.fiatOutput.bankTx.created;
    const owedChf = this.owedChf(bf);

    const transit = await this.transit(this.outputCurrency(bf));
    const bankLeg = await this.bankCrLeg(bf, bookingDate, marks);

    // §4.7a FX-P&L leg = −(Σ CHF) → INCOME/EXPENSE fx-revaluation (EUR drift between reclassification and booking)
    const legs: LedgerLegInput[] = [this.chfLeg(transit, owedChf), bankLeg];
    await this.appendFxResidual(legs);

    await this.bookingService.bookTx({
      sourceType: SOURCE_TYPE,
      sourceId: `${bf.id}`,
      seq: 3,
      bookingDate,
      valueDate: bf.fiatOutput.bankTx.valueDate ?? bookingDate,
      legs,
    });
  }

  // === (II) PAYMENTLINK MERCHANT PAYOUT (§4.7b) === //

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
    // reconstruct as outputReferenceAmount − outputAmount (both persisted :199/:206), the schluss-consistent value
    const plFeeNative = Util.round((bf.outputReferenceAmount ?? 0) - (bf.outputAmount ?? 0), 8);
    const plFeeChf = Util.round(plFeeNative * this.owedReferenceRate(bf), 2);
    const feeChf = Util.round(totalFee + plFeeChf, 2);

    const outputChf = this.owedChf(bf); // outputAmount × reclassification-mark
    const venueSpread = Util.round(openingChf - outputChf - feeChf, 2); // the real Krypto↔Fiat sell-spread

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

  // === SHARED HELPERS === //

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

  // §4.7a — appends the FX-P&L leg = −(Σ CHF) for the EUR/output drift; CHF output → drift 0 → no leg
  private async appendFxResidual(legs: LedgerLegInput[]): Promise<void> {
    const sumCents = legs.reduce((s, l) => s + Math.round(Util.round(l.amountChf ?? 0, 2) * 100), 0);
    if (Math.abs(sumCents) <= Config.ledger.roundingToleranceCents) return; // sub-cent → ROUNDING

    const residualChf = Util.round(-sumCents / 100, 2);
    const account = residualChf >= 0 ? await this.income('fx-revaluation') : await this.expense('fx-revaluation');
    legs.push(this.chfLeg(account, residualChf));
  }

  // owed_chf = the reclassification CHF (amountInChf − totalFeeAmountChf), the value seq1 credited to owed.
  // For paymentLink it is the net merchant fiat output_chf = outputAmount × reclassification-mark.
  private owedChf(bf: BuyFiat): number {
    if (bf.cryptoInput?.paymentLinkPayment) return Util.round((bf.outputAmount ?? 0) * this.owedReferenceRate(bf), 2);
    return Util.round((bf.amountInChf ?? 0) - (bf.totalFeeAmountChf ?? 0), 2);
  }

  // CHF-per-output-unit at the reclassification mark, derived from the persisted reference (outputReferenceAmount
  // is the fiat reference, amountInChf its CHF value) — a deterministic ratio, NOT a market mark lookup
  private owedReferenceRate(bf: BuyFiat): number {
    const ref = bf.outputReferenceAmount;
    if (ref == null || ref === 0 || bf.amountInChf == null) return this.outputCurrency(bf) === CHF ? 1 : 0;
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

  // === GATE (§4.7 G-a/G-b) === //

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

    // G-b: cutover opening on buyFiat-received for this buy_fiat.id (synthetic seq0 marker, §6.1)
    const gb = await this.ledgerTxRepo.countBy({ sourceType: CUTOVER_SOURCE, sourceId: `:buy_fiat:${bf.id}` });
    return gb > 0;
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

  private async alreadyBooked(id: number, seq: number): Promise<boolean> {
    return (await this.bookingService.nextSeq(SOURCE_TYPE, `${id}`)) > seq;
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
