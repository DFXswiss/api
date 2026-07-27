import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Config } from 'src/config/config';
import { ExchangeTx, ExchangeTxType } from 'src/integration/exchange/entities/exchange-tx.entity';
import { ExchangeName } from 'src/integration/exchange/enums/exchange.enum';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { BankTx, BankTxIndicator, BankTxType } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { Between, In, MoreThan, Repository } from 'typeorm';
import { AccountType, LedgerAccount } from '../../entities/ledger-account.entity';
import { LedgerLeg } from '../../entities/ledger-leg.entity';
import { LedgerLegRepository } from '../../repositories/ledger-leg.repository';
import { LedgerAccountService } from '../ledger-account.service';
import { LedgerBookingService, LedgerLegInput, LedgerTxInput } from '../ledger-booking.service';
import { LedgerMarkCache, LedgerMarkService } from '../ledger-mark.service';
import { resolveLegsOrDefer } from './ledger-mark-bridge.helper';
import {
  getLedgerWatermark,
  isCoveredByCutoverOpening,
  runContentChangeScan,
  setLedgerWatermark,
} from './ledger-watermark.helper';

const OK_STATUS = 'ok';
const SOURCE_TYPE = 'exchange_tx';
const TRADE_SOURCE_TYPE = 'ExchangeTrade';
const RAIFFEISEN_SUSPENSE = 'SUSPENSE/untracked-bank-Raiffeisen-EUR';
const SWEEP_MATCH_DAYS = 5; // ≤5d amount/date window (§4.3b, reuse findSenderReceiverPair logic, D13 A.4)

/**
 * Books exchange_tx Deposit/Withdrawal (route-disambiguated, §4.3a/§4.3b) and Trade (venue-spread-disambiguated,
 * §4.3) — ONE @DfxCron method, ONE flag (Minor R8-1): deposits/withdrawals first, then trades. Pure observer:
 * reads exchange_tx (+ bank_tx for route matching, + ledger legs for the Raiffeisen sweep), writes only ledger_*.
 *
 * Only status='ok' (eliminates Class 2). Trade seq = batch-stable, re-run-idempotent fill_index (Blocker R1-7).
 */
@Injectable()
export class ExchangeTxConsumer {
  private readonly logger = new DfxLogger(ExchangeTxConsumer);

  constructor(
    private readonly settingService: SettingService,
    private readonly bookingService: LedgerBookingService,
    private readonly accountService: LedgerAccountService,
    private readonly markService: LedgerMarkService,
    @InjectRepository(ExchangeTx) private readonly exchangeTxRepo: Repository<ExchangeTx>,
    @InjectRepository(BankTx) private readonly bankTxRepo: Repository<BankTx>,
    private readonly ledgerLegRepository: LedgerLegRepository,
  ) {}

  async process(): Promise<void> {
    const watermark = (await getLedgerWatermark(this.settingService, SOURCE_TYPE)) ?? {
      lastProcessedId: 0,
      lastReversalScan: new Date(0),
    };

    await this.processForward(watermark);

    // content-change scan (§4.3 reversal-trigger): the forward scan filters status='ok', so a row that was booked as
    // 'ok' and LATER flips to failed/canceled is never re-selected forward (Class-2 elimination would break — the
    // invalid booking stays). This scan selects by `updated > lastReversalScan` (status-agnostic) and, per row:
    //  - status != 'ok' → flat-reverse the active booking (the trade/deposit became invalid → "nothing booked");
    //  - status == 'ok' with an amount/fee/route change → reverse + re-book the corrected legs (§4.12).
    // Runs ALSO when the forward batch is empty. Re-read the watermark in case the forward batch advanced it.
    const afterForward = (await getLedgerWatermark(this.settingService, SOURCE_TYPE)) ?? watermark;
    await runContentChangeScan(
      this.settingService,
      SOURCE_TYPE,
      afterForward,
      this.exchangeTxRepo,
      {},
      async (tx: ExchangeTx) => this.reconcileBooking(tx),
    );
  }

  private async processForward(watermark: { lastProcessedId: number; lastReversalScan: Date }): Promise<void> {
    const batch = await this.exchangeTxRepo.find({
      where: { id: MoreThan(watermark.lastProcessedId), status: OK_STATUS },
      order: { id: 'ASC' },
      take: Config.ledger.backfillBatchSize,
    });
    if (!batch.length) return;

    const times = batch.map((tx) => (tx.externalCreated ?? tx.created).getTime());
    const marks = await this.markService.preload(
      // lookback so getMarkAt finds the latest mark at-or-before the earliest row timestamp
      Util.daysBefore(2, new Date(Math.min(...times))),
      new Date(Math.max(...times)),
    );
    const fillIndexMap = await this.buildFillIndexMap(batch);

    let lastProcessedId = watermark.lastProcessedId;
    for (const tx of batch) {
      try {
        if (!(await this.alreadyBooked(tx, fillIndexMap))) {
          const spec = await this.buildSpec(tx, marks, fillIndexMap);
          if (spec) await this.bookingService.bookTx(spec);
        }
        lastProcessedId = tx.id;
      } catch (e) {
        this.logger.error(`Failed to book exchange_tx ${tx.id}:`, e);
        break; // failure-isolation: leave watermark unchanged, retry next run (§4-header)
      }
    }

    if (lastProcessedId > watermark.lastProcessedId) {
      await setLedgerWatermark(this.settingService, SOURCE_TYPE, { ...watermark, lastProcessedId });
    }
  }

  // §4.3 content-change reconcile: a row whose status flipped away from 'ok' is flat-reversed (the booking became
  // invalid); an 'ok' row whose amount/fee/route changed is reversed + re-booked with the corrected legs (§4.12).
  private async reconcileBooking(tx: ExchangeTx): Promise<void> {
    const t = tx.externalCreated ?? tx.created;
    // lookback so getMarkAt finds the latest mark at-or-before the row timestamp
    const marks = await this.markService.preload(Util.daysBefore(2, t), t);
    const fillIndexMap = await this.buildFillIndexMap([tx]);
    const spec = await this.buildSpec(tx, marks, fillIndexMap);
    if (!spec) return; // unbookable type → nothing to correct

    if (tx.status !== OK_STATUS) {
      // ok→failed/canceled: the previously-booked tx must be removed (flat reversal, no re-book) — the row's
      // identifiers are recomputed verbatim from buildSpec so the reversal targets exactly the original booking.
      await this.bookingService.reverseActiveIfBooked(spec.sourceType, spec.sourceId, spec.seq);
      return;
    }

    // status 'ok': first correct an already-active booking whose amount/fee/route changed (§4.12).
    if (await this.bookingService.reverseAndRebookIfChanged(spec)) return;

    // C1: reverseAndRebookIfChanged found nothing to correct — either the booking is active-and-unchanged, or the row
    // never got a forward booking because it turned 'ok' only AFTER the id-watermark advanced over it (the forward
    // scan filters status='ok'). Forward-book it iff NO tx has EVER been booked at this exact (sourceType, sourceId,
    // seq): a late-settling row → book; an active-unchanged / flat-reversed one → skip (bookTx would collide UNIQUE).
    // §6.3 covered-by-cutover-opening guard (keyed on the exchange_tx row id, not the composite trade sourceId): a row
    // already 'ok' (settled) at the cutover snapshot has its value in the aggregate ASSET opening — re-booking its seq0
    // would double-count. A hole / post-boundary row is NOT covered → it still books fresh.
    if (
      !(await this.bookingService.hasAnyTxAt(spec.sourceType, spec.sourceId, spec.seq)) &&
      !(await isCoveredByCutoverOpening(this.settingService, SOURCE_TYPE, tx.id))
    ) {
      await this.bookingService.bookTx(spec);
    }
  }

  // builds the LedgerTxInput spec for an exchange_tx (or undefined for an unhandled type) — shared by the forward
  // booker and the content-change reconcile so reversal targets the exact (sourceType, sourceId, seq) it was booked at.
  private async buildSpec(
    tx: ExchangeTx,
    marks: LedgerMarkCache,
    fillIndexMap: Map<number, number>,
  ): Promise<LedgerTxInput | undefined> {
    const bookingDate = tx.externalCreated ?? tx.created;

    switch (tx.type) {
      case ExchangeTxType.DEPOSIT:
        return this.depositSpec(tx, bookingDate, marks);
      case ExchangeTxType.WITHDRAWAL:
        return this.withdrawalSpec(tx, bookingDate, marks);
      case ExchangeTxType.TRADE:
        return this.tradeSpec(tx, bookingDate, marks, fillIndexMap);
      default:
        this.logger.error(`Unhandled exchange_tx type ${tx.type} on exchange_tx ${tx.id}`);
        return undefined;
    }
  }

  // §4.3/§4.3a — Deposit: Dr ASSET/{exchange}/{ccy} / Cr {routeCounterAccount}
  private async depositSpec(tx: ExchangeTx, bookingDate: Date, marks: LedgerMarkCache): Promise<LedgerTxInput> {
    const asset = await this.exchangeAsset(tx);
    const chf = this.depositChf(tx, asset, bookingDate, marks);
    const counter = await this.routeCounterAccount(tx, bookingDate);

    const assetLeg: LedgerLegInput = {
      account: asset,
      amount: +tx.amount,
      priceChf: chf.priceChf,
      amountChf: chf.amountChf,
      needsMark: chf.needsMark,
    };
    const counterLeg: LedgerLegInput = {
      account: counter,
      amount: -tx.amount,
      priceChf: chf.priceChf,
      amountChf: chf.amountChf != null ? -chf.amountChf : undefined,
      needsMark: chf.needsMark,
    };

    return this.singleSpec(tx, bookingDate, [assetLeg, counterLeg]);
  }

  // §4.3/§4.3a — Withdrawal: Dr {routeCounterAccount} / Cr ASSET/{exchange}/{ccy} (mirror)
  private async withdrawalSpec(tx: ExchangeTx, bookingDate: Date, marks: LedgerMarkCache): Promise<LedgerTxInput> {
    const asset = await this.exchangeAsset(tx);
    const chf = this.depositChf(tx, asset, bookingDate, marks);
    const counter = await this.routeCounterAccount(tx, bookingDate);

    const assetLeg: LedgerLegInput = {
      account: asset,
      amount: -tx.amount,
      priceChf: chf.priceChf,
      amountChf: chf.amountChf != null ? -chf.amountChf : undefined,
      needsMark: chf.needsMark,
    };
    const counterLeg: LedgerLegInput = {
      account: counter,
      amount: +tx.amount,
      priceChf: chf.priceChf,
      amountChf: chf.amountChf,
      needsMark: chf.needsMark,
    };

    return this.singleSpec(tx, bookingDate, [counterLeg, assetLeg]);
  }

  // §4.3 — Trade: Dr ASSET/{exchange}/{base} / Cr ASSET/{exchange}/{quote} + spread + (ccxt) fee leg
  private async tradeSpec(
    tx: ExchangeTx,
    bookingDate: Date,
    marks: LedgerMarkCache,
    fillIndexMap: Map<number, number>,
  ): Promise<LedgerTxInput> {
    const parsed = this.parseSymbol(tx);
    if (!parsed) {
      // unattributable trade → SUSPENSE rest + alarm (§4.3, not silently dropped)
      const suspense = await this.accountService.findOrCreate(
        `SUSPENSE/${tx.exchange}-trade-unattributed`,
        AccountType.SUSPENSE,
        'CHF',
      );
      this.logger.error(`exchange_tx ${tx.id} trade has no resolvable symbol/side → SUSPENSE`);
      const chf = tx.amountChf ?? 0;
      return this.singleSpec(tx, bookingDate, [
        { account: suspense, amount: chf, priceChf: 1, amountChf: chf },
        { account: suspense, amount: -chf, priceChf: 1, amountChf: -chf },
      ]);
    }

    const { base, quote, isBuy } = parsed;
    const baseAccount = await this.exchangeAssetByCcy(tx.exchange, base);
    const quoteAccount = await this.exchangeAssetByCcy(tx.exchange, quote);

    // base leg: +amount on buy / −amount on sell; CHF = persisted amountChf (stage 1) ?? mark
    const baseAmount = isBuy ? +tx.amount : -tx.amount;
    const baseChf = tx.amountChf ?? this.markValue(baseAccount, tx.amount, bookingDate, marks);
    const baseLeg: LedgerLegInput = {
      account: baseAccount,
      amount: baseAmount,
      priceChf: baseChf != null ? Util.round(Math.abs(baseChf) / Math.abs(tx.amount || 1), 8) : null,
      amountChf: baseChf != null ? (isBuy ? baseChf : -baseChf) : undefined,
      needsMark: baseChf == null,
    };

    // A4: a settled ('ok') trade with NO cost (quote amount) is a data error — `cost ?? 0` would book a zero-quote trade
    // and plug the FULL base value into spread (a phantom). Fail loud for an 'ok' trade; a non-'ok' row keeps `?? 0`
    // because its spec is only used to target the flat reversal (sourceId/seq), never booked.
    if (tx.cost == null && tx.status === OK_STATUS) {
      throw new Error(
        `exchange_tx ${tx.id} is an 'ok' trade with no cost (quote amount) — refusing to book a zero-quote`,
      );
    }
    const cost = tx.cost ?? 0;
    const quoteAmount = isBuy ? -cost : +cost;

    const legs: LedgerLegInput[] = [baseLeg];
    const isMarketSpreadFee = tx.exchange === ExchangeName.SCRYPT; // Scrypt feeAmountChf IS the market spread (§4.3)

    if (isMarketSpreadFee) {
      // Scrypt: ONE persisted spread leg = feeAmountChf (sign-aware), quote leg as plug (§4.3 variant i)
      const spreadChf = tx.feeAmountChf ?? 0;
      if (spreadChf !== 0) legs.push(await this.spreadLeg(tx.exchange, spreadChf));

      // F4: resolve/bridge the base (and any unvalued asset) leg BEFORE forming the quote plug — exactly like the ccxt
      // branch. Otherwise an unvalued base leg is silently counted as 0 CHF and the quote plug absorbs the FULL base
      // value (the quote custody account misvalued by the whole base). resolveLegsOrDefer bridges the base with the
      // youngest available mark (needsMark stays true); a truly feedless base defers the row (throw) instead of misbooking.
      await resolveLegsOrDefer(legs, this.markService, this.logger, `exchange_tx ${tx.id} trade`);

      const plugChf = -legs.reduce((s, l) => s + (l.amountChf ?? 0), 0); // quote leg closes the tx (base now valued)
      const quotePrice = quoteAmount !== 0 ? Util.round(Math.abs(plugChf) / Math.abs(quoteAmount), 8) : null;
      legs.push({
        account: quoteAccount,
        amount: quoteAmount,
        priceChf: quotePrice,
        amountChf: plugChf,
        // a bridged (provisional) base makes the quote plug provisional too → let the mark-to-market job re-mark the
        // quote account; with a real historical base mark the plug is the intended cost basis and needs no re-mark (F4)
        needsMark: legs.some((l) => l.needsMark),
      });
    } else {
      // ccxt (Binance/MEXC/Kraken): quote leg with its OWN mark (not plug) + separate venue fee leg + a
      // mark-based quote-spread plug leg that absorbs the base↔quote mark residual (§4.3, two distinct legs)
      const quoteChf = this.markValue(quoteAccount, cost, bookingDate, marks);
      legs.push({
        account: quoteAccount,
        amount: quoteAmount,
        priceChf: quoteChf != null ? Util.round(Math.abs(quoteChf) / Math.abs(cost || 1), 8) : null,
        amountChf: quoteChf != null ? (isBuy ? -quoteChf : +quoteChf) : undefined,
        needsMark: quoteChf == null,
      });

      const feeChf = tx.feeAmountChf; // separate venue fee (real ccxt fee, sign-aware)
      if (feeChf != null && feeChf !== 0) legs.push(await this.spreadLeg(tx.exchange, feeChf));

      // mark-based quote-spread leg: closes the base↔quote mark residual to 0 (sign-aware). Major B5: an ASSET leg
      // without a historical mark is first bridged with the youngest available mark (resolveLegsOrDefer) so the trade
      // balances — needsMark stays true, the mark-to-market job corrects the basis later. A truly feedless asset (no
      // bridge) defers the row instead of handing an unbalanceable set to bookTx.
      if (await resolveLegsOrDefer(legs, this.markService, this.logger, `exchange_tx ${tx.id} trade`)) {
        const residualChf = -legs.reduce((s, l) => s + (l.amountChf ?? 0), 0);
        const residualCents = Math.round(Util.round(residualChf, 2) * 100);
        if (Math.abs(residualCents) > Config.ledger.roundingToleranceCents) {
          legs.push(await this.spreadLeg(tx.exchange, residualChf));
        }
      }
    }

    return { ...this.bookingKey(tx, fillIndexMap), bookingDate, valueDate: bookingDate, legs };
  }

  // --- ROUTE DISAMBIGUATION (§4.3a/§4.3b) --- //

  // determines the route-passing counter account of a deposit/withdrawal (read-only, §4.3a)
  private async routeCounterAccount(tx: ExchangeTx, bookingDate: Date): Promise<LedgerAccount> {
    const ex = tx.exchange;
    const ccy = tx.currency ?? tx.asset;

    // (R1) Raiffeisen sweep: Scrypt/EUR deposit matched against an open SUSPENSE/untracked-bank-Raiffeisen-EUR post
    if (tx.type === ExchangeTxType.DEPOSIT && ex === ExchangeName.SCRYPT && ccy === 'EUR') {
      const sweep = await this.matchRaiffeisenSweep(tx.amount, bookingDate);
      if (sweep === 'match') {
        return this.accountService.findOrCreate(RAIFFEISEN_SUSPENSE, AccountType.SUSPENSE, 'EUR');
      }
      if (sweep === 'ambiguous') {
        // two equal-amount open posts → leave in SUSPENSE + alarm, no guessing (§4.3b)
        this.logger.error(`exchange_tx ${tx.id} Scrypt/EUR deposit ambiguous Raiffeisen sweep match → SUSPENSE`);
        return this.accountService.findOrCreate(RAIFFEISEN_SUSPENSE, AccountType.SUSPENSE, 'EUR');
      }
    }

    // (R2) bank→exchange: matching bank_tx KRAKEN/SCRYPT/SCB on the same route → TRANSIT/bank↔{ex}/{ccy}
    if (await this.hasBankRouteMatch(tx, bookingDate)) {
      return this.accountService.findOrCreate(`TRANSIT/bank↔${ex}/${ccy}`, AccountType.TRANSIT, ccy);
    }

    // (R3) wallet→exchange: txId present (on-chain reference) → TRANSIT/wallet↔{ex}/{ccy}
    if (tx.txId) {
      return this.accountService.findOrCreate(`TRANSIT/wallet↔${ex}/${ccy}`, AccountType.TRANSIT, ccy);
    }

    // (R4) no route determinable → SUSPENSE/{exchange}-deposit-unrouted/{ccy} + alarm (visible, not hidden)
    this.logger.error(`exchange_tx ${tx.id} deposit/withdrawal unrouted → SUSPENSE/${ex}-deposit-unrouted/${ccy}`);
    return this.accountService.findOrCreate(`SUSPENSE/${ex}-deposit-unrouted/${ccy}`, AccountType.SUSPENSE, ccy);
  }

  // ≤5d amount/date window match against open Raiffeisen SUSPENSE posts (§4.3b)
  private async matchRaiffeisenSweep(amount: number, bookingDate: Date): Promise<'match' | 'ambiguous' | 'none'> {
    const account = await this.accountService.findByName(RAIFFEISEN_SUSPENSE);
    if (!account) return 'none';

    const from = Util.daysBefore(SWEEP_MATCH_DAYS, bookingDate);
    const posts = await this.ledgerLegRepository.find({
      where: { account: { id: account.id }, tx: { bookingDate: Between(from, bookingDate) } },
      relations: { tx: true, account: true },
    });

    // open Raiffeisen credits opened the post as a Dr (+amount, value entered SUSPENSE) for the sweep amount
    const matches = posts.filter(
      (p: LedgerLeg) => Math.abs(Math.abs(p.amount) - Math.abs(amount)) < 1e-8 && p.amount > 0,
    );
    if (matches.length === 1) return 'match';
    if (matches.length > 1) return 'ambiguous';
    return 'none';
  }

  // read-only: a bank_tx KRAKEN/SCRYPT/SCB on the same currency within a date window (§4.3a-R2 rebuilt)
  private async hasBankRouteMatch(tx: ExchangeTx, bookingDate: Date): Promise<boolean> {
    const ccy = tx.currency ?? tx.asset;
    if (!ccy) return false;

    const indicator = tx.type === ExchangeTxType.DEPOSIT ? BankTxIndicator.DEBIT : BankTxIndicator.CREDIT;
    const from = Util.daysBefore(SWEEP_MATCH_DAYS, bookingDate);
    const to = Util.daysAfter(SWEEP_MATCH_DAYS, bookingDate);

    const matches = await this.bankTxRepo.find({
      where: {
        type: In([BankTxType.KRAKEN, BankTxType.SCRYPT, BankTxType.SCB]),
        currency: ccy,
        creditDebitIndicator: indicator,
        bookingDate: Between(from, to),
      },
      take: 5,
    });

    return matches.some((b) => Math.abs(Math.abs(b.amount ?? 0) - Math.abs(tx.amount)) < 0.005);
  }

  // --- FILL-INDEX (§4.3 Blocker R1-7, bounded per batch, Major R2-4) --- //

  // pre-computes the deterministic 0-based fill rank per (exchange, order) once per batch, in-memory
  private async buildFillIndexMap(batch: ExchangeTx[]): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    const orderKeys = new Set<string>();
    for (const tx of batch) {
      if (tx.type === ExchangeTxType.TRADE && tx.order) orderKeys.add(`${tx.exchange}|${tx.order}`);
    }
    if (!orderKeys.size) return map;

    const orders = [...orderKeys].map((k) => k.split('|')[1]);
    // Major B4: rank over ALL fills of the order, status-AGNOSTIC (no status='ok' filter). Dense ranking over only the
    // current 'ok' set is unstable: when a sibling fill flips ok→failed it drops out of the set and every later
    // survivor's rank shifts down by one → the survivor's seq changes → its active booking is stranded at the old seq
    // (cross-fill corruption) or its correction is silently discarded. `id`/`order` are immutable, so ranking over all
    // fills gives each fill a permanent id-ordered slot; a failed fill keeps its slot (its booking is flat-reversed by
    // reconcileBooking, which does not need the slot freed) → survivors never move.
    const existing = await this.exchangeTxRepo.find({
      where: { type: ExchangeTxType.TRADE, order: In(orders) },
      select: { id: true, exchange: true, order: true },
    });

    // merge the batch rows over the query result: the ranking is status-agnostic (all fills of the order, any status),
    // so a fill that flipped away from 'ok' still appears and keeps its id-ordered slot; the merge only refreshes each
    // batch row's (exchange, order) from the freshest in-memory copy (and covers a fill not yet visible to the read).
    // Ranking is by id and order-preserving → a fill's rank is immutable, so the reversal targets the right seq (§4.3).
    const merged = new Map<number, { id: number; exchange: string; order?: string }>();
    for (const e of existing) merged.set(e.id, e);
    for (const tx of batch) {
      if (tx.type === ExchangeTxType.TRADE && tx.order)
        merged.set(tx.id, { id: tx.id, exchange: tx.exchange, order: tx.order });
    }

    const byKey = Util.groupByAccessor<{ id: number; exchange: string; order?: string }, string>(
      [...merged.values()],
      (e) => `${e.exchange}|${e.order}`,
    );
    for (const rows of byKey.values()) {
      rows.sort((a, b) => a.id - b.id);
      rows.forEach((row, idx) => map.set(row.id, idx));
    }

    return map;
  }

  // --- BOOKING IDENTITY --- //

  /**
   * The (sourceType, sourceId, seq) a row books at, derived from immutable row fields ONLY — no leg build, no account
   * or mark lookup. A trade with BOTH an order and a resolvable symbol books under the composite trade key; every
   * other row — deposits, withdrawals, order-less trades and unattributable ones (parseSymbol undefined → the
   * SUSPENSE `singleSpec` branch) — books at (exchange_tx, `${id}`, 0). Single source of truth: tradeSpec returns it
   * verbatim, so the pre-book guard can never drift from the key the booking actually lands on.
   *
   * Major B3: the composite trade sourceId MUST carry the exchange prefix `${exchange}:${order}`, matching the
   * `${exchange}|${order}` fill-ranking key (buildFillIndexMap). Without it, the SAME order string on two different
   * exchanges collapses to one sourceId → two distinct fills claim the same (sourceType, sourceId, seq) → UNIQUE
   * collision on the second booker → permanent wedge. `${tx.id}` stays the fallback for an order-less trade.
   */
  private bookingKey(
    tx: ExchangeTx,
    fillIndexMap: Map<number, number>,
  ): { sourceType: string; sourceId: string; seq: number } {
    const isCompositeTrade = tx.type === ExchangeTxType.TRADE && !!tx.order && !!this.parseSymbol(tx);

    return isCompositeTrade
      ? {
          sourceType: TRADE_SOURCE_TYPE,
          sourceId: `${tx.exchange}:${tx.order}`,
          seq: fillIndexMap.get(tx.id) ?? 0,
        }
      : { sourceType: SOURCE_TYPE, sourceId: `${tx.id}`, seq: 0 };
  }

  /**
   * Crash-recovery guard for the forward scan (sibling convention, e.g. bank-tx.consumer.ts `alreadyBooked`).
   *
   * `bookTx` commits its own transaction but the id-watermark is written ONCE at the end of the batch, and the §4.12
   * content-change scan books the very same rows through `reconcileBooking` while advancing only its own (updated, id)
   * cursor. Either path can leave `lastProcessedId` BEHIND a row that is already booked. Without this guard the next
   * forward run re-books that row, collides on the (sourceType, sourceId, seq) UNIQUE constraint, breaks out of the
   * batch, and the watermark never advances again — the source wedges permanently and every later row stops booking.
   *
   * Checked BEFORE buildSpec so an already-booked row is treated as done regardless of what a fresh leg re-derivation
   * would do (it can itself throw or defer). The guard only ever fires where the unguarded call would have thrown:
   * `hasAnyTxAt` is true exactly when an append-only bookTx at that key is impossible. Correcting an already-committed
   * booking stays the content-change scan's job (§4.12).
   */
  private alreadyBooked(tx: ExchangeTx, fillIndexMap: Map<number, number>): Promise<boolean> {
    const { sourceType, sourceId, seq } = this.bookingKey(tx, fillIndexMap);

    return this.bookingService.hasAnyTxAt(sourceType, sourceId, seq);
  }

  // --- HELPERS --- //

  private singleSpec(tx: ExchangeTx, bookingDate: Date, legs: LedgerLegInput[]): LedgerTxInput {
    return {
      sourceType: SOURCE_TYPE,
      sourceId: `${tx.id}`,
      seq: 0,
      bookingDate,
      valueDate: bookingDate,
      legs,
    };
  }

  // §4.3 amountChf null fallback (Minor R9-4): persisted amountChf (stage 1) ?? mark × amount (stage 2) ?? needsMark
  private depositChf(
    tx: ExchangeTx,
    asset: LedgerAccount,
    bookingDate: Date,
    marks: LedgerMarkCache,
  ): { priceChf: number | null; amountChf?: number; needsMark: boolean } {
    if (tx.amountChf != null) {
      const priceChf = tx.amount ? Util.round(tx.amountChf / tx.amount, 8) : null;
      return { priceChf, amountChf: tx.amountChf, needsMark: false };
    }

    const mark = asset.assetId != null ? marks.getMarkAt(asset.assetId, bookingDate) : undefined;
    if (mark != null) return { priceChf: mark, amountChf: Util.round(mark * tx.amount, 2), needsMark: false };

    return { priceChf: null, amountChf: undefined, needsMark: true };
  }

  private markValue(
    asset: LedgerAccount,
    amount: number,
    bookingDate: Date,
    marks: LedgerMarkCache,
  ): number | undefined {
    const mark = asset.assetId != null ? marks.getMarkAt(asset.assetId, bookingDate) : undefined;
    return mark != null ? Util.round(mark * Math.abs(amount), 2) : undefined;
  }

  // sign-aware spread leg: feeAmountChf > 0 → EXPENSE/spread-{exchange}; < 0 (maker rebate) → INCOME/spread-{exchange}
  private async spreadLeg(exchange: ExchangeName, feeAmountChf: number): Promise<LedgerLegInput> {
    const type = feeAmountChf > 0 ? AccountType.EXPENSE : AccountType.INCOME;
    const prefix = feeAmountChf > 0 ? 'EXPENSE' : 'INCOME';
    const account = await this.accountService.findOrCreate(`${prefix}/spread-${exchange}`, type, 'CHF');
    return { account, amount: feeAmountChf, priceChf: 1, amountChf: feeAmountChf };
  }

  private async exchangeAsset(tx: ExchangeTx): Promise<LedgerAccount> {
    return this.exchangeAssetByCcy(tx.exchange, tx.currency ?? tx.asset);
  }

  private async exchangeAssetByCcy(exchange: ExchangeName, ccy?: string): Promise<LedgerAccount> {
    if (!ccy) throw new Error(`exchange_tx asset/currency missing for ${exchange}`);
    const account = await this.accountService.findByName(`${exchange}/${ccy}`);
    if (!account) throw new Error(`Ledger account ${exchange}/${ccy} not found (CoA bootstrap missing)`);
    return account;
  }

  // trade base/quote via symbol+side (not null-pair); reuse dashboard-reconciliation parse logic (rebuilt, §4.3)
  private parseSymbol(tx: ExchangeTx): { base: string; quote: string; isBuy: boolean } | undefined {
    if (!tx.symbol || !tx.side) return undefined;
    const parts = tx.symbol.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
    return { base: parts[0], quote: parts[1], isBuy: tx.side.toLowerCase() === 'buy' };
  }
}
