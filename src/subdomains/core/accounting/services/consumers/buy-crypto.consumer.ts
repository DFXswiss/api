import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Config } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { MoreThan, Repository } from 'typeorm';
import { AccountType, LedgerAccount } from '../../entities/ledger-account.entity';
import { LedgerLeg } from '../../entities/ledger-leg.entity';
import { LedgerTx } from '../../entities/ledger-tx.entity';
import { LedgerAccountService } from '../ledger-account.service';
import { LedgerBookingService, LedgerLegInput, LedgerTxInput } from '../ledger-booking.service';
import { LedgerGateBlockedException } from './ledger-gate-blocked.exception';
import {
  getLedgerWatermark,
  isUnpricedAtCutover,
  runContentChangeScan,
  setLedgerWatermark,
} from './ledger-watermark.helper';

const SOURCE_TYPE = 'buy_crypto';
const CRYPTO_INPUT_SOURCE = 'crypto_input';
const BANK_TX_SOURCE = 'bank_tx';
const CUTOVER_SOURCE = 'cutover';
const CUTOVER_LOG_ID_KEY = 'ledgerCutoverLogId';
const CUTOVER_SNAPSHOT_DATE_KEY = 'ledgerCutoverSnapshotDate';
const CHF = 'CHF';
const PAYMENT_LINK = 'LIABILITY/paymentLink';

/**
 * Books the buy_crypto completion chain (§4.6, D14 A). Pure observer: reads buy_crypto (+ ledger_tx for the
 * seq0/opening gate), writes only ledger_*.
 *
 * It does NOT book the crypto-input leg (CryptoInput consumer is the single booker, §4.1) — only the Card input
 * (Checkout) at seq0, and at seq1 the cent-exact 4-leg completion tx: fee against `received` + reclassification
 * received→owed. It skips actualPayoutFeeAmount (network fee booked by the payout_order consumer, §4.5).
 * Owed-straddling rows (per-row cutover owed opening, §6.1) are skipped entirely — the reclassification is anchored
 * in that opening and the payout_order consumer (§4.5) closes owed against it.
 */
@Injectable()
export class BuyCryptoConsumer {
  private readonly logger = new DfxLogger(BuyCryptoConsumer);

  constructor(
    private readonly settingService: SettingService,
    private readonly bookingService: LedgerBookingService,
    private readonly accountService: LedgerAccountService,
    @InjectRepository(BuyCrypto) private readonly buyCryptoRepo: Repository<BuyCrypto>,
    @InjectRepository(LedgerTx) private readonly ledgerTxRepo: Repository<LedgerTx>,
  ) {}

  async process(): Promise<void> {
    const watermark = (await getLedgerWatermark(this.settingService, SOURCE_TYPE)) ?? {
      lastProcessedId: 0,
      lastReversalScan: new Date(0),
    };

    await this.processForward(watermark);

    // content-change scan (§4.12 / §6.3): catches late-settling cutover-straddling rows (id <= watermark, completion
    // set post-cutover) the forward id-scan skips — runs ALSO when the forward batch is empty. The booker is
    // idempotent (per-seq alreadyBooked), so a row in both scans is booked once. Re-read the watermark in case the
    // forward batch advanced lastProcessedId above.
    const afterForward = (await getLedgerWatermark(this.settingService, SOURCE_TYPE)) ?? watermark;
    await runContentChangeScan(
      this.settingService,
      SOURCE_TYPE,
      afterForward,
      this.buyCryptoRepo,
      { checkoutTx: true, cryptoInput: { paymentLinkPayment: true }, bankTx: true },
      async (bc: BuyCrypto) => {
        // forward book() FIRST: append any newly-settled seqs / forward-book a late-settling row the id-watermark
        // skipped. A gate-blocked run returns false → distinguish a pre-cutover-settled row (value in the aggregate
        // opening, C2) → SKIP+advance, from a genuinely post-cutover row whose received opening is not yet booked →
        // THROW (cursor stays put, retry). Returning here for a gate-blocked row ALSO avoids resolving+creating the
        // value-coupled accounts below for a never-booked row (no phantom LIABILITY/buyCrypto-owed).
        if (!(await this.book(bc))) {
          if (await this.preCutoverSettled(bc)) return;
          // F2: an open row unpriced at the cutover (amountInChf NULL) never got a per-row received opening — its gross
          // is in the aggregate ASSET opening (the Checkout collateral feed). Its received gate can NEVER open, so
          // SKIP+advance with an ERROR alarm instead of throwing forever (head-of-line wedge); buildCardInputSeq0 also
          // skips it so the gross is not double-booked once the row is priced. Manual re-anchoring is traced by the alarm.
          if (await isUnpricedAtCutover(this.settingService, SOURCE_TYPE, bc.id)) {
            this.logger.error(
              `buy_crypto ${bc.id} was unpriced at the cutover (value in the aggregate opening) — skipping its per-row chain (F2 alarm)`,
            );
            return;
          }
          throw new LedgerGateBlockedException(
            `buy_crypto ${bc.id} content-change scan gate-blocked — retry next run (§4.7 G-a)`,
          );
        }

        // §6.1 owed-straddling: this consumer booked NOTHING for such a row (the reclassification is anchored in the
        // cutover owed opening, closed by the payout_order consumer) — building the reverse/rebook chain below would
        // findOrCreate phantom accounts for a never-booked row. Mirrors the buy-fiat callback's owed-straddling skip.
        if (await this.hasCutoverOwedOpening(bc.id)) return;

        // then §4.12 + M3: on a content change, reverse+rebook the value-coupled Card-input seq0 / completion seq1 chain
        // (both carry the amountInChf base). Reversing ONLY seq0 while seq1 is booked would leave `received` non-zero
        // (the shared liability never closes to 0); the chain method reverses the whole ACTIVE chain atomically and
        // no-ops when nothing changed (incl. the seqs book() just forward-booked). buildCardInputSeq0 is undefined for a
        // non-Card / pre-cutover-settled row and buildCompletionSeq1 for a not-yet-complete row → each drops out.
        const chain = (await Promise.all([this.buildCardInputSeq0(bc), this.buildCompletionSeq1(bc)])).filter(
          (i): i is LedgerTxInput => i != null,
        );
        if (chain.length) await this.bookingService.reverseAndRebookChainIfChanged(chain);
      },
    );
  }

  private async processForward(watermark: { lastProcessedId: number; lastReversalScan: Date }): Promise<void> {
    const batch = await this.buyCryptoRepo.find({
      where: { id: MoreThan(watermark.lastProcessedId) },
      relations: { checkoutTx: true, cryptoInput: { paymentLinkPayment: true }, bankTx: true },
      order: { id: 'ASC' },
      take: Config.ledger.backfillBatchSize,
    });
    if (!batch.length) return;

    let lastProcessedId = watermark.lastProcessedId;
    for (const bc of batch) {
      try {
        const advance = await this.book(bc);
        // a gate-blocked seq1 must NOT advance the watermark past this row (retry next run, §4.7 G-a)
        if (!advance) break;
        lastProcessedId = bc.id;
      } catch (e) {
        this.logger.error(`Failed to book buy_crypto ${bc.id}:`, e);
        break; // failure-isolation: leave watermark unchanged, retry next run (§4-header)
      }
    }

    if (lastProcessedId > watermark.lastProcessedId) {
      await setLedgerWatermark(this.settingService, SOURCE_TYPE, { ...watermark, lastProcessedId });
    }
  }

  // returns false when seq1 is gate-blocked (received not yet opened) → the caller must not advance past this row
  private async book(bc: BuyCrypto): Promise<boolean> {
    // §4.6/§6.1 owed-straddling: the cutover booked this row's per-row owed opening and the payout_order consumer
    // (§4.5) closes owed against exactly that anchor — this consumer must book NEITHER seq0 NOR seq1. Booking them
    // would wedge a bank/crypto-funded row (receivedOpened never true → the content-change scan throws forever) or
    // double-count a Card row (seq0+seq1 on top of the owed opening) → skip both and advance the watermark.
    if (await this.hasCutoverOwedOpening(bc.id)) return true;

    await this.bookCardInput(bc); // seq0 (Card only; bank/crypto inputs have their own single booker)

    if (!bc.isComplete) return true; // completion not settled yet — nothing more to do, advance
    if (await this.alreadyBooked(bc.id, 1)) return true; // seq1 already booked

    // gate (§4.6/§4.7 G-a/G-b): seq1 is bookable only once `received` has been opened
    if (!(await this.receivedOpened(bc))) return false;

    await this.bookCompletion(bc); // seq1
    return true;
  }

  // §4.6 seq0 — Card input only: Dr ASSET/Checkout/{ccy} (native = card-currency GROSS, amountChf = gross CHF) /
  // Cr LIABILITY/buyCrypto-received (= amountInChf). Convention (F2): Checkout/{ccy} carries native gross in card
  // currency on EVERY leg with amountChf = the corresponding gross CHF → amountChf ≈ mark × amount holds per leg and
  // on the account aggregate, so the mark-to-market job books only genuine FX drift, never a phantom.
  // Bank input → BankTx consumer; crypto input → CryptoInput consumer (§4.1 single booker).
  private async bookCardInput(bc: BuyCrypto): Promise<void> {
    if (await this.alreadyBooked(bc.id, 0)) return;

    const input = await this.buildCardInputSeq0(bc);
    if (input) await this.bookingService.bookTx(input);
  }

  // builds the seq0 Card-input LedgerTxInput, or undefined for a non-Card input / missing amountInChf (the bank /
  // crypto inputs are booked by their own single booker, §4.1)
  private async buildCardInputSeq0(bc: BuyCrypto): Promise<LedgerTxInput | undefined> {
    if (!bc.checkoutTx) return undefined; // not a Card input → seq0 not this consumer's job
    if (bc.amountInChf == null) return undefined;
    // F2: a Card row unpriced at the cutover (amountInChf NULL then) already has its card-currency gross in the
    // aggregate ASSET opening (the Checkout collateral feed) — once it is priced post-cutover, re-booking the forward
    // seq0 would re-debit that gross on Checkout/{ccy} a SECOND time (double-count). The pinned id suppresses the seq0.
    if (await isUnpricedAtCutover(this.settingService, SOURCE_TYPE, bc.id)) return undefined;
    // §6.3: a Card row already settled at the cutover (outputDate ≤ snapshot) is captured by the aggregate opening
    // (openAssets) — re-booking its seq0 Checkout inflow would double-count. Only post-cutover Card rows get a
    // forward seq0.
    if (await this.settledBeforeCutover(bc)) return undefined;
    // §6.1 (Major B1): an OPEN-at-cutover Card row has BOTH its card-currency gross in the aggregate ASSET opening
    // (openAssets → liquidityBalance.total carries the Checkout.com collateral feed of auto-captured card charges) AND
    // its received LIABILITY opened by the cutover per-row marker `${snapshotLogId}:buy_crypto:${id}`. Re-booking the
    // forward seq0 would re-debit that gross on Checkout/{ccy} a second time (permanent phantom). Skip when the marker
    // exists — the completion seq1 closes received against the cutover opening; only a post-cutover Card row (no
    // marker) gets a forward seq0 as its own opening.
    if (await this.hasCutoverReceivedOpening(bc.id)) return undefined;

    // FAIL-LOUD (F2): a priced Card row (amountInChf set) without its card-currency gross (inputReferenceAmount —
    // the CHECKOUT branch of pendingInputAmount() carries the card gross there) is a data error. Booking native 0 or
    // a CHF native on the card-currency Checkout/{ccy} custody account would silently corrupt the account's native
    // unit — throw instead; the consumer's failure-isolation retries the row on the next run.
    if (bc.inputReferenceAmount == null || bc.inputReferenceAmount === 0) {
      throw new Error(`buy_crypto ${bc.id} Card input has amountInChf but no card-currency inputReferenceAmount`);
    }

    const checkout = await this.checkoutAccount(bc.checkoutTx.currency);
    const received = await this.liability('buyCrypto-received');

    return {
      sourceType: SOURCE_TYPE,
      sourceId: `${bc.id}`,
      seq: 0,
      bookingDate: bc.created,
      valueDate: bc.created,
      legs: [
        // custody Dr: native = card-currency gross; priceChf = the implied CHF-per-card-unit conversion of THIS row
        // (amountInChf / inputReferenceAmount) → amountChf = priceChf × amount holds exactly on the leg (F2)
        {
          account: checkout,
          amount: bc.inputReferenceAmount,
          priceChf: Util.round(bc.amountInChf / bc.inputReferenceAmount, 8),
          amountChf: bc.amountInChf,
          needsMark: false,
        },
        this.chfLeg(received, -bc.amountInChf), // LIABILITY is CHF-denominated: native == CHF (correct as is)
      ],
    };
  }

  /**
   * §4.6 seq1 — cent-exact 4-leg completion tx (Major R4-3): (a) Fee against `received`
   * Dr received +totalFeeAmountChf / Cr INCOME/fee-{buyCrypto|paymentLink} −totalFeeAmountChf; (b) reclassification
   * Dr received +(amountInChf−totalFeeAmountChf) / Cr buyCrypto-owed. After seq1 `received` = 0, `owed` =
   * −(amountInChf−totalFeeAmountChf) (cleared later by the payout_order consumer, §4.5).
   */
  private async bookCompletion(bc: BuyCrypto): Promise<void> {
    const input = await this.buildCompletionSeq1(bc);
    if (input) await this.bookingService.bookTx(input);
  }

  // builds the seq1 completion LedgerTxInput, or undefined for a not-yet-complete row (nothing to book / no chain link)
  private async buildCompletionSeq1(bc: BuyCrypto): Promise<LedgerTxInput | undefined> {
    if (!bc.isComplete) return undefined;
    if (bc.amountInChf == null) throw new Error(`buy_crypto ${bc.id} is complete but amountInChf is null`);

    const fee = bc.totalFeeAmountChf ?? 0; // additive null-strategy (§5.1): missing fee = 0
    const reclassChf = Util.round(bc.amountInChf - fee, 2);
    const owed = await this.liability('buyCrypto-owed');

    // §4.6 F3: a paymentLink-funded buy_crypto's crypto_input seq0 (§4.4 isPayment) credited LIABILITY/paymentLink —
    // NOT buyCrypto-received. Clearing buyCrypto-received here (which was never credited for this row) drifts both
    // liabilities apart unbounded (equity-neutral, parity-blind). Clear paymentLink against the seq0 opening value
    // instead. Only when that seq0 opening exists; a cutover-straddling paymentLink row (no seq0, received opened as
    // buyCrypto-received by the cutover) falls through to the received clearing below (unchanged, no drift).
    if (bc.paymentLinkPayment) {
      const openingChf = await this.paymentLinkOpeningChf(bc);
      if (openingChf != null) return this.buildPaymentLinkCompletionSeq1(bc, fee, reclassChf, owed, openingChf);
    }

    const received = await this.liability('buyCrypto-received');
    // paymentLink-linked → the fee is INCOME/fee-paymentLink (§4.6); else INCOME/fee-buyCrypto
    const feeIncome = await this.income(bc.paymentLinkPayment ? 'fee-paymentLink' : 'fee-buyCrypto');

    const legs: LedgerLegInput[] = [
      this.chfLeg(received, fee), // (a) Dr received +fee
      this.chfLeg(feeIncome, -fee), //     Cr INCOME −fee
      this.chfLeg(received, reclassChf), // (b) Dr received +(amountInChf−fee)
      this.chfLeg(owed, -reclassChf), //       Cr owed −(amountInChf−fee)
    ];

    return {
      sourceType: SOURCE_TYPE,
      sourceId: `${bc.id}`,
      seq: 1,
      bookingDate: bc.outputDate ?? bc.updated,
      valueDate: bc.outputDate ?? bc.updated,
      legs,
    };
  }

  /**
   * §4.6 F3 paymentLink completion — debits LIABILITY/paymentLink by exactly the seq0 opening value (Mark×amount, the
   * gross crypto received) so paymentLink closes cent-exact to 0: (a) fee → INCOME/fee-paymentLink; (b) reclassification
   * → buyCrypto-owed (= amountInChf − fee, closed later by the payout_order consumer); (c) the venue-sell-spread
   * (opening − amountInChf) → the fx-revaluation plug (valuation drift, NOT income). Total paymentLink debit =
   * fee + reclass + venueSpread = openingChf → closes the seq0 −openingChf credit to 0. Mirrors buy-fiat bookPaymentLinkFee.
   */
  private async buildPaymentLinkCompletionSeq1(
    bc: BuyCrypto,
    fee: number,
    reclassChf: number,
    owed: LedgerAccount,
    openingChf: number,
  ): Promise<LedgerTxInput> {
    const paymentLink = await this.paymentLinkAccount();
    const feeIncome = await this.income('fee-paymentLink');
    const venueSpread = Util.round(openingChf - (bc.amountInChf ?? 0), 2); // crypto received value vs the amountInChf base

    const legs: LedgerLegInput[] = [
      this.chfLeg(paymentLink, fee), // (a) Dr paymentLink +fee
      this.chfLeg(feeIncome, -fee), //     Cr INCOME/fee-paymentLink −fee
      this.chfLeg(paymentLink, reclassChf), // (b) Dr paymentLink +(amountInChf−fee)
      this.chfLeg(owed, -reclassChf), //       Cr owed −(amountInChf−fee)
    ];
    if (venueSpread !== 0) {
      legs.push(this.chfLeg(paymentLink, venueSpread)); // (c) Dr paymentLink +venueSpread → total debit reaches openingChf
      const fx = venueSpread >= 0 ? await this.income('fx-revaluation') : await this.expense('fx-revaluation');
      legs.push(this.chfLeg(fx, -venueSpread));
    }

    return {
      sourceType: SOURCE_TYPE,
      sourceId: `${bc.id}`,
      seq: 1,
      bookingDate: bc.outputDate ?? bc.updated,
      valueDate: bc.outputDate ?? bc.updated,
      legs,
    };
  }

  // §4.6 F3 — the crypto_input seq0 paymentLink opening CHF (= −leg.amountChf) for a paymentLink-funded buy_crypto, or
  // undefined when no seq0 paymentLink leg exists (a cutover-straddling row financed pre-cutover). Mirrors the buy-fiat
  // paymentLinkOpeningChf gate/value.
  private async paymentLinkOpeningChf(bc: BuyCrypto): Promise<number | undefined> {
    const cryptoInputId = bc.cryptoInput?.id;
    if (cryptoInputId == null) return undefined;

    const seq0 = await this.ledgerTxRepo.findOne({
      where: { sourceType: CRYPTO_INPUT_SOURCE, sourceId: `${cryptoInputId}`, seq: 0 },
      relations: { legs: { account: true } },
    });
    const leg = seq0?.legs?.find((l: LedgerLeg) => l.account?.name === PAYMENT_LINK);
    if (leg?.amountChf == null) return undefined;

    return Util.round(-leg.amountChf, 2); // seq0 Cr leg is −Mark×amount → opening value is its absolute CHF
  }

  // --- GATE (§4.6/§4.7 G-a/G-b) --- //

  // received is opened either by the seq0 CryptoInput ledger_tx (G-a, post-cutover) or by the cutover opening
  // (G-b, cutover-straddling — the pre-cutover-settled crypto_input never gets a seq0 ledger_tx)
  private async receivedOpened(bc: BuyCrypto): Promise<boolean> {
    // Card input (§6.1 Major B1): received is opened by EITHER the cutover per-row marker (G-b, an OPEN-at-cutover Card
    // row whose forward seq0 is skipped — its gross is already in the aggregate opening) OR this consumer's own forward
    // seq0 (G-a analog, a post-cutover Card row). A row already settled at the cutover (outputDate ≤ snapshot) has
    // NEITHER — its value is fully in the aggregate opening and no per-row marker exists → gate stays closed, so seq1
    // never Dr's received without a matching −opening (mirrors the non-Card pre-cutover-settled path).
    if (bc.checkoutTx) {
      if (await this.settledBeforeCutover(bc)) return false; // pre-cutover-settled → aggregate opening, no marker/seq0
      if (await this.hasCutoverReceivedOpening(bc.id)) return true; // G-b: open-at-cutover cutover received opening
      return this.alreadyBooked(bc.id, 0); // G-a analog: this consumer's forward Card seq0 opened received
    }

    // Bank input: the BankTx consumer opens buyCrypto-received as the bank_tx seq0 booking (§4.2 BUY_CRYPTO legs).
    // Gate on an ACTIVE bank_tx seq0 tx for this row's funding bank_tx — per-seq via hasActiveTxAt (walks the §4.12
    // reversal chain, so a content-change reversal/re-book of that opening still resolves), analogous to G-a. Falls
    // through to the G-b cutover marker below for a cutover-straddling bank-funded row (opened by the cutover, not
    // by a bank_tx seq0).
    if (bc.bankTx && (await this.bookingService.hasActiveTxAt(BANK_TX_SOURCE, `${bc.bankTx.id}`, 0))) return true;

    const cryptoInputId = bc.cryptoInput?.id;
    if (
      cryptoInputId != null &&
      (await this.ledgerTxRepo.existsBy({ sourceType: CRYPTO_INPUT_SOURCE, sourceId: `${cryptoInputId}`, seq: 0 }))
    ) {
      return true; // G-a
    }

    // G-b: cutover opening on buyCrypto-received for this buy_crypto.id (synthetic seq0 marker, §6.1).
    return this.hasCutoverReceivedOpening(bc.id);
  }

  // the full cutover per-row received marker sourceId (§6.1 / §4.7 G-b): `${snapshotLogId}:buy_crypto:${id}`.
  // The prefix is the snapshot logId, persisted in ledgerCutoverLogId by the cutover (§6.3 step 5).
  private async cutoverReceivedSourceId(buyCryptoId: number): Promise<string | undefined> {
    const cutoverLogId = await this.settingService.get(CUTOVER_LOG_ID_KEY);
    return cutoverLogId != null ? `${cutoverLogId}:buy_crypto:${buyCryptoId}` : undefined;
  }

  // §6.1 / §4.7 G-b: true iff the cutover booked the per-row received opening `${snapshotLogId}:buy_crypto:${id}` for
  // this row (open-at-cutover: its gross is already in the aggregate opening, so buildCardInputSeq0 is skipped and this
  // marker is the sole `received` opening). The snapshot logId prefix must be resolved from ledgerCutoverLogId — an
  // exact `:buy_crypto:${id}` match would NEVER hit (missing prefix → G-b dead, Blocker R4-2). Absent logId (cutover
  // not run) → no opening to match.
  private async hasCutoverReceivedOpening(buyCryptoId: number): Promise<boolean> {
    const cutoverSourceId = await this.cutoverReceivedSourceId(buyCryptoId);
    if (cutoverSourceId == null) return false;
    return this.ledgerTxRepo.existsBy({ sourceType: CUTOVER_SOURCE, sourceId: cutoverSourceId });
  }

  // §6.1: true iff the cutover booked the per-row owed opening `${snapshotLogId}:buy_crypto-owed:${id}` for this row
  // (owed-straddling: outputAmount set, not complete at the snapshot). The reclassification is anchored in that
  // opening and the payout_order consumer (§4.5) closes owed against it — this consumer books nothing for such a row.
  private async hasCutoverOwedOpening(buyCryptoId: number): Promise<boolean> {
    const cutoverLogId = await this.settingService.get(CUTOVER_LOG_ID_KEY);
    if (cutoverLogId == null) return false;
    return this.ledgerTxRepo.existsBy({
      sourceType: CUTOVER_SOURCE,
      sourceId: `${cutoverLogId}:buy_crypto-owed:${buyCryptoId}`,
    });
  }

  // §6.3: true iff this Card row's completion is at/before the cutover snapshot → its value is already in the aggregate
  // opening (openAssets), so its seq0/seq1 must NOT be (re-)booked. The completion marker is `outputDate`: the immutable
  // payout timestamp set exactly once when the buy-crypto completes. Unlike `updated` (which a post-cutover flag change —
  // chargeback/mail — pushes past the snapshot; that is the very Scenario-B trigger) `outputDate` still reflects whether
  // the row had settled at the cutover. Non-Card rows are handled by the natural G-a/G-b gate → this guards Card only.
  private async settledBeforeCutover(bc: BuyCrypto): Promise<boolean> {
    return !!bc.checkoutTx && (await this.preCutoverSettled(bc)); // Card-only variant of the general predicate below
  }

  // C2: true iff this row's settlement (outputDate) is at/before the cutover snapshot → its value is already in the
  // aggregate opening (openAssets/openLiabilities), NEVER a per-row cutover marker (openBuyCrypto* opens ONLY rows
  // still OPEN at the snapshot, whose outputDate is null or > snapshot). Used by the content-change scan to SKIP+advance
  // a forever-gate-blocked pre-cutover-settled row instead of throwing — the "no marker" half of §6.1 is implied here
  // because being gate-blocked already means receivedOpened found neither a G-a seq0 nor a G-b marker.
  private async preCutoverSettled(bc: BuyCrypto): Promise<boolean> {
    if (!bc.isComplete || bc.outputDate == null) return false;

    const snapshotDate = await this.cutoverSnapshotDate();
    return snapshotDate != null && bc.outputDate <= snapshotDate;
  }

  // the pinned cutover snapshot date (§6.3), exported by the cutover (ledger-cutover.service step 4). Absent → cutover
  // not run yet → no pre-cutover classification applies (forward-only booking, the pre-cutover default).
  private async cutoverSnapshotDate(): Promise<Date | undefined> {
    const iso = await this.settingService.get(CUTOVER_SNAPSHOT_DATE_KEY);
    return iso != null ? new Date(iso) : undefined;
  }

  // --- HELPERS --- //

  private chfLeg(account: LedgerAccount, amountChf: number): LedgerLegInput {
    return { account, amount: amountChf, priceChf: 1, amountChf };
  }

  // §4.12 (R3): a seq is "already booked" iff an ACTIVE (not reversed-without-rebook) tx exists AT this seq — NOT
  // `nextSeq > seq`. After a content-change reversal of seq0 (reversal seq=N, re-book seq=N+1) MAX(seq) jumps past 1,
  // so `nextSeq > 1` would wrongly report the completion as booked and it would never run → buyCrypto-received never
  // reclassifies to owed. hasActiveTxAt walks the reversal chain of the ORIGINAL at this exact seq.
  private async alreadyBooked(id: number, seq: number): Promise<boolean> {
    return this.bookingService.hasActiveTxAt(SOURCE_TYPE, `${id}`, seq);
  }

  private async checkoutAccount(currency: string): Promise<LedgerAccount> {
    const account = await this.accountService.findByName(`Checkout/${currency}`);
    if (!account) throw new Error(`Ledger account Checkout/${currency} not found (CoA bootstrap missing)`);
    return account;
  }

  private liability(qualifier: string): Promise<LedgerAccount> {
    return this.accountService.findOrCreate(`LIABILITY/${qualifier}`, AccountType.LIABILITY, CHF);
  }

  private paymentLinkAccount(): Promise<LedgerAccount> {
    return this.accountService.findOrCreate(PAYMENT_LINK, AccountType.LIABILITY, CHF);
  }

  private income(qualifier: string): Promise<LedgerAccount> {
    return this.accountService.findOrCreate(`INCOME/${qualifier}`, AccountType.INCOME, CHF);
  }

  private expense(qualifier: string): Promise<LedgerAccount> {
    return this.accountService.findOrCreate(`EXPENSE/${qualifier}`, AccountType.EXPENSE, CHF);
  }
}
