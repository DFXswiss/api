import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Config } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { MoreThan, Repository } from 'typeorm';
import { AccountType, LedgerAccount } from '../../entities/ledger-account.entity';
import { LedgerTx } from '../../entities/ledger-tx.entity';
import { LedgerAccountService } from '../ledger-account.service';
import { LedgerBookingService, LedgerLegInput, LedgerTxInput } from '../ledger-booking.service';
import { getLedgerWatermark, runContentChangeScan, setLedgerWatermark } from './ledger-watermark.helper';

const SOURCE_TYPE = 'buy_crypto';
const CRYPTO_INPUT_SOURCE = 'crypto_input';
const CUTOVER_SOURCE = 'cutover';
const CUTOVER_LOG_ID_KEY = 'ledgerCutoverLogId';
const CHF = 'CHF';

/**
 * Books the buy_crypto completion chain (§4.6, D14 A). Pure observer: reads buy_crypto (+ ledger_tx for the
 * seq0/opening gate), writes only ledger_*.
 *
 * It does NOT book the crypto-input leg (CryptoInput consumer is the single booker, §4.1) — only the Card input
 * (Checkout) at seq0, and at seq1 the cent-exact 4-leg completion tx: fee against `received` + reclassification
 * received→owed. It skips actualPayoutFeeAmount (network fee booked by the payout_order consumer, §4.5).
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
      { checkoutTx: true, cryptoInput: { paymentLinkPayment: true } },
      async (bc: BuyCrypto) => {
        // §4.12: a Card-input amount/fee change (amountInChf) reverses + re-books the seq0 Card-input tx; then the
        // idempotent forward book() appends any newly-settled seqs (seq1 completion). Non-Card inputs have no seq0
        // here (booked by the CryptoInput/BankTx single booker) → buildSeq0Input returns undefined → no-op reversal.
        const seq0 = await this.buildCardInputSeq0(bc);
        if (seq0) await this.bookingService.reverseAndRebookIfChanged(seq0);
        await this.book(bc);
      },
    );
  }

  private async processForward(watermark: { lastProcessedId: number; lastReversalScan: Date }): Promise<void> {
    const batch = await this.buyCryptoRepo.find({
      where: { id: MoreThan(watermark.lastProcessedId) },
      relations: { checkoutTx: true, cryptoInput: { paymentLinkPayment: true } },
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
        this.logger.error(`Failed to book buy_crypto ${bc.id}`, e);
        break; // failure-isolation: leave watermark unchanged, retry next run (§4-header)
      }
    }

    if (lastProcessedId > watermark.lastProcessedId) {
      await setLedgerWatermark(this.settingService, SOURCE_TYPE, { ...watermark, lastProcessedId });
    }
  }

  // returns false when seq1 is gate-blocked (received not yet opened) → the caller must not advance past this row
  private async book(bc: BuyCrypto): Promise<boolean> {
    await this.bookCardInput(bc); // seq0 (Card only; bank/crypto inputs have their own single booker)

    if (!bc.isComplete) return true; // completion not settled yet — nothing more to do, advance
    if (await this.alreadyBooked(bc.id, 1)) return true; // seq1 already booked

    // gate (§4.6/§4.7 G-a/G-b): seq1 is bookable only once `received` has been opened
    if (!(await this.receivedOpened(bc))) return false;

    await this.bookCompletion(bc); // seq1
    return true;
  }

  // §4.6 seq0 — Card input only: Dr ASSET/Checkout{ccy} / Cr LIABILITY/buyCrypto-received (= amountInChf).
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

    const checkout = await this.checkoutAccount(bc.checkoutTx.currency);
    const received = await this.liability('buyCrypto-received');

    return {
      sourceType: SOURCE_TYPE,
      sourceId: `${bc.id}`,
      seq: 0,
      bookingDate: bc.created,
      valueDate: bc.created,
      legs: [this.chfLeg(checkout, bc.amountInChf), this.chfLeg(received, -bc.amountInChf)],
    };
  }

  /**
   * §4.6 seq1 — cent-exact 4-leg completion tx (Major R4-3): (a) Fee against `received`
   * Dr received +totalFeeAmountChf / Cr INCOME/fee-{buyCrypto|paymentLink} −totalFeeAmountChf; (b) reclassification
   * Dr received +(amountInChf−totalFeeAmountChf) / Cr buyCrypto-owed. After seq1 `received` = 0, `owed` =
   * −(amountInChf−totalFeeAmountChf) (cleared later by the payout_order consumer, §4.5).
   */
  private async bookCompletion(bc: BuyCrypto): Promise<void> {
    if (bc.amountInChf == null) throw new Error(`buy_crypto ${bc.id} is complete but amountInChf is null`);

    const fee = bc.totalFeeAmountChf ?? 0; // additive null-strategy (§5.1): missing fee = 0
    const reclassChf = Util.round(bc.amountInChf - fee, 2);

    const received = await this.liability('buyCrypto-received');
    const owed = await this.liability('buyCrypto-owed');
    // paymentLink-linked → the fee is INCOME/fee-paymentLink (§4.6); else INCOME/fee-buyCrypto
    const feeIncome = await this.income(bc.paymentLinkPayment ? 'fee-paymentLink' : 'fee-buyCrypto');

    const legs: LedgerLegInput[] = [
      this.chfLeg(received, fee), // (a) Dr received +fee
      this.chfLeg(feeIncome, -fee), //     Cr INCOME −fee
      this.chfLeg(received, reclassChf), // (b) Dr received +(amountInChf−fee)
      this.chfLeg(owed, -reclassChf), //       Cr owed −(amountInChf−fee)
    ];

    await this.bookingService.bookTx({
      sourceType: SOURCE_TYPE,
      sourceId: `${bc.id}`,
      seq: 1,
      bookingDate: bc.outputDate ?? bc.updated,
      valueDate: bc.outputDate ?? bc.updated,
      legs,
    });
  }

  // --- GATE (§4.6/§4.7 G-a/G-b) --- //

  // received is opened either by the seq0 CryptoInput ledger_tx (G-a, post-cutover) or by the cutover opening
  // (G-b, cutover-straddling — the pre-cutover-settled crypto_input never gets a seq0 ledger_tx)
  private async receivedOpened(bc: BuyCrypto): Promise<boolean> {
    if (bc.checkoutTx) return true; // Card input opened received via this consumer's own seq0

    const cryptoInputId = bc.cryptoInput?.id;
    if (cryptoInputId != null) {
      const ga = await this.ledgerTxRepo.countBy({
        sourceType: CRYPTO_INPUT_SOURCE,
        sourceId: `${cryptoInputId}`,
        seq: 0,
      });
      if (ga > 0) return true; // G-a
    }

    // G-b: cutover opening on buyCrypto-received for this buy_crypto.id (synthetic seq0 marker, §6.1). The cutover
    // writes `${snapshotLogId}:buy_crypto:${id}`, so the prefix must be resolved from ledgerCutoverLogId — an exact
    // `:buy_crypto:${id}` match would NEVER hit (the snapshot logId prefix is missing → G-b dead, Blocker R4-2).
    const cutoverSourceId = await this.cutoverReceivedSourceId(bc.id);
    if (cutoverSourceId == null) return false; // cutover not run yet → no opening to match
    const gb = await this.ledgerTxRepo.countBy({ sourceType: CUTOVER_SOURCE, sourceId: cutoverSourceId });
    return gb > 0;
  }

  // the full cutover per-row received marker sourceId (§6.1 / §4.7 G-b): `${snapshotLogId}:buy_crypto:${id}`.
  // The prefix is the snapshot logId, persisted in ledgerCutoverLogId by the cutover (§6.3 step 5).
  private async cutoverReceivedSourceId(buyCryptoId: number): Promise<string | undefined> {
    const cutoverLogId = await this.settingService.get(CUTOVER_LOG_ID_KEY);
    return cutoverLogId != null ? `${cutoverLogId}:buy_crypto:${buyCryptoId}` : undefined;
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
    if (!account) throw new Error(`ledger account Checkout/${currency} not found (CoA bootstrap missing)`);
    return account;
  }

  private liability(qualifier: string): Promise<LedgerAccount> {
    return this.accountService.findOrCreate(`LIABILITY/${qualifier}`, AccountType.LIABILITY, CHF);
  }

  private income(qualifier: string): Promise<LedgerAccount> {
    return this.accountService.findOrCreate(`INCOME/${qualifier}`, AccountType.INCOME, CHF);
  }
}
