import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { BankTx, BankTxIndicator, BankTxType } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { LessThan, MoreThan, Repository } from 'typeorm';
import { AccountType, LedgerAccount } from '../../entities/ledger-account.entity';
import { LedgerLeg } from '../../entities/ledger-leg.entity';
import { LedgerTx } from '../../entities/ledger-tx.entity';
import { LedgerAccountService } from '../ledger-account.service';
import { LedgerBookingService, LedgerLegInput, LedgerTxInput } from '../ledger-booking.service';
import { LedgerMarkCache, LedgerMarkService } from '../ledger-mark.service';
import { getLedgerWatermark, runContentChangeScan, setLedgerWatermark } from './ledger-watermark.helper';

const SOURCE_TYPE = 'bank_tx';
const CUTOVER_SOURCE = 'cutover';
const CUTOVER_LOG_ID_KEY = 'ledgerCutoverLogId';
const BUY_CRYPTO_OWED = 'LIABILITY/buyCrypto-owed';
const CHF = 'CHF';

// bank-side exchange route segment per type (§3.3 {ex}); SCB route is created lazily (§3.3 "neue Routen lazy")
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
  ) {}

  async process(): Promise<void> {
    const watermark = (await getLedgerWatermark(this.settingService, SOURCE_TYPE)) ?? {
      lastProcessedId: 0,
      lastReversalScan: new Date(0),
    };

    await this.processForward(watermark);

    // content-change scan (§4.12): re-classification of an already-booked bank_tx (the §4.12 musterbeispiel
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
      { buyCrypto: true },
      async (tx: BankTx) => {
        await this.reconcileBooking(
          tx,
          await this.markService.preload(tx.bookingDate ?? tx.created, tx.bookingDate ?? tx.created),
        );
      },
    );
  }

  private async processForward(watermark: { lastProcessedId: number; lastReversalScan: Date }): Promise<void> {
    // DBIT only after 5 min (analog assignTransactions); settlement = bookingDate ?? created (§4.2)
    const batch = await this.bankTxRepo.find({
      where: { id: MoreThan(watermark.lastProcessedId), created: LessThan(Util.minutesBefore(5)) },
      relations: { buyCrypto: true },
      order: { id: 'ASC' },
      take: Config.ledger.backfillBatchSize,
    });
    if (!batch.length) return;

    const from = Util.minObj(batch, 'created').created;
    const to = Util.maxObj(batch, 'created').created;
    const marks = await this.markService.preload(from, to);

    let lastProcessedId = watermark.lastProcessedId;
    for (const tx of batch) {
      try {
        await this.book(tx, marks);
        lastProcessedId = tx.id;
      } catch (e) {
        this.logger.error(`Failed to book bank_tx ${tx.id}`, e);
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
    if (amountInChf == null) throw new Error(`bank_tx ${tx.id} BUY_CRYPTO without buyCrypto.amountInChf`);

    const bank = this.bankAssetLeg(ctx, +tx.amount, bookingDate, marks, await this.bankAccount(ctx)); // mark-consistent
    const received = this.namedLeg(await this.liability('buyCrypto-received'), -amountInChf);

    return this.withFxPlug([bank, received]);
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

    // owed-Dr (completion/opening CHF) + bank-Cr (EUR-mark) → withFxPlug routes the mark/valuation drift to
    // EXPENSE/INCOME fx-revaluation, owed closes cent-exact to 0 (§4.2a). CHF account → drift 0 → 2-leg, no plug.
    return this.withFxPlug([owed, bank]);
  }

  // the CHF the buyCrypto-owed was opened with: §4.6 completion (amountInChf − totalFeeAmountChf), or — for a
  // cutover-straddling buy_crypto whose owed was opened by the cutover (§6.1 per-row marker) — the opening CHF.
  private async buyCryptoOwedChf(tx: BankTx): Promise<number> {
    const openingChf = await this.cutoverOwedOpeningChf(tx.buyCrypto?.id);
    if (openingChf != null) return openingChf; // cutover-straddling: debit the exact opening CHF anchor

    const amountInChf = tx.buyCrypto?.amountInChf;
    if (amountInChf == null) throw new Error(`bank_tx ${tx.id} BUY_CRYPTO_RETURN without buyCrypto.amountInChf`);
    return Util.round(amountInChf - (tx.buyCrypto?.totalFeeAmountChf ?? 0), 2); // completion CHF (additive null-strategy)
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
    const counter = await this.accountService.findOrCreate(counterName, AccountType.TRANSIT, ctx.currency);

    return [
      bank,
      {
        account: counter,
        amount: -bank.amount,
        priceChf: bank.priceChf,
        amountChf: bank.amountChf != null ? -bank.amountChf : undefined,
        needsMark: bank.needsMark,
      },
    ];
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

    return this.withFxPlug([expense, bank]); // ≤2c → ROUNDING, >2c → fx-revaluation (§4.2-Note B-10)
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

    return [expense, bank];
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

  // §4.2 BANK_TX_REPEAT_CHARGEBACK DBIT: Dr LIABILITY/{bucket} / Cr ASSET/bank
  private async liabilityDebitLegs(
    tx: BankTx,
    ctx: BankContext,
    bookingDate: Date,
    marks: LedgerMarkCache,
    bucket: string,
  ): Promise<LedgerLegInput[]> {
    const bank = this.bankAssetLeg(ctx, -tx.amount, bookingDate, marks, await this.bankAccount(ctx));
    const liability = this.namedLeg(await this.liability(bucket), -(bank.amountChf ?? 0));

    return [liability, bank];
  }

  // §4.2 BANK_TX_RETURN_CHARGEBACK DBIT: Dr LIABILITY/{bucket} / Cr ASSET/bank (+ EXPENSE/bank-fee chargeAmountChf)
  private async chargebackLegs(
    tx: BankTx,
    ctx: BankContext,
    bookingDate: Date,
    marks: LedgerMarkCache,
    bucket: string,
  ): Promise<LedgerLegInput[]> {
    const bank = this.bankAssetLeg(ctx, -tx.amount, bookingDate, marks, await this.bankAccount(ctx));
    const legs: LedgerLegInput[] = [bank];

    const feeChf = tx.chargeAmountChf;
    if (feeChf != null && feeChf !== 0) legs.push(this.namedLeg(await this.expense('bank-fee'), feeChf)); // Pricing anchor

    // LIABILITY-Dr = opening CHF; closes against bank + fee, residual via plug (§4.2-Note B-15)
    const liabilityChf = -legs.reduce((s, l) => s + (l.amountChf ?? 0), 0);
    legs.unshift(this.namedLeg(await this.liability(bucket), liabilityChf));

    return this.withFxPlug(legs); // ≤2c → ROUNDING, >2c → fx-revaluation
  }

  // §4.2 CHECKOUT_LTD CRDT: Dr ASSET/bank (netto) + Dr EXPENSE/acquirer-fee / Cr ASSET/Checkout (brutto), CHF-only
  private async checkoutLtdLegs(
    tx: BankTx,
    ctx: BankContext,
    bookingDate: Date,
    marks: LedgerMarkCache,
  ): Promise<LedgerLegInput[]> {
    const bank = this.bankAssetLeg(ctx, +tx.amount, bookingDate, marks, await this.bankAccount(ctx)); // netto
    const feeChf = tx.chargeAmountChf ?? 0;
    const netChf = bank.amountChf;
    const legs: LedgerLegInput[] = [bank];

    if (feeChf !== 0) legs.push(this.namedLeg(await this.expense('acquirer-fee'), feeChf));

    // brutto Checkout custody Cr-leg: no own *Chf → CHF = netto + fee (both CHF-known), else needsMark (Minor R3-5)
    const grossChf = netChf != null ? netChf + feeChf : undefined;
    legs.push({
      account: await this.checkoutAccount(ctx.currency),
      amount: -tx.amount,
      priceChf: null,
      amountChf: grossChf != null ? -grossChf : undefined,
      needsMark: grossChf == null,
    });

    return legs;
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
    const suspense = await this.accountService.findOrCreate('SUSPENSE', AccountType.SUSPENSE, CHF);

    return [
      bank,
      {
        account: suspense,
        amount: -bank.amount,
        priceChf: bank.priceChf,
        amountChf: bank.amountChf != null ? -bank.amountChf : undefined,
        needsMark: bank.needsMark,
      },
    ];
  }

  // --- LEG/ACCOUNT HELPERS --- //

  // the bank ASSET leg native+CHF (mark-consistent). `account` is pre-resolved (ASSET/bank or SUSPENSE/untracked)
  private bankAssetLeg(
    ctx: BankContext,
    signedAmount: number,
    bookingDate: Date,
    marks: LedgerMarkCache,
    account: LedgerAccount,
  ): LedgerLegInput {
    const mark = ctx.currency === CHF ? 1 : ctx.asset ? marks.getMarkAt(ctx.asset.id, bookingDate) : undefined;
    const amountChf = mark != null ? Util.round(mark * signedAmount, 2) : undefined;

    return { account, amount: signedAmount, priceChf: mark ?? null, amountChf, needsMark: amountChf == null };
  }

  // CHF-denominated counter leg (LIABILITY/INCOME/EXPENSE): native amount == CHF amount, priceChf = 1
  private namedLeg(account: LedgerAccount, amountChf: number): LedgerLegInput {
    return { account, amount: amountChf, priceChf: 1, amountChf };
  }

  // appends an EXPENSE/INCOME fx-revaluation plug for a remaining CHF residual > tolerance (§4.2a); sub-cent →
  // the booking-service ROUNDING leg closes it (no plug created)
  private async withFxPlug(legs: LedgerLegInput[]): Promise<LedgerLegInput[]> {
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
      if (!account) throw new Error(`ledger account for asset ${ctx.asset.id} not found (CoA bootstrap missing)`);
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
    if (!account) throw new Error(`ledger account Checkout/${currency} not found (CoA bootstrap missing)`);
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
      if (bank) return { asset: bank.asset, currency: bank.currency, bankName: bank.name, tracked: bank.asset != null };
    }

    const currency = tx.currency ?? CHF; // no bank match → untracked, currency from the tx
    return { asset: undefined, currency, bankName: tx.bankName ?? 'unknown', tracked: false };
  }
}
