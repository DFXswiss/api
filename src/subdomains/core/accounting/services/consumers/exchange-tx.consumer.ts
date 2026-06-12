import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Config } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { ExchangeName } from 'src/integration/exchange/enums/exchange.enum';
import { ExchangeTx, ExchangeTxType } from 'src/integration/exchange/entities/exchange-tx.entity';
import { BankTx, BankTxIndicator, BankTxType } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { Between, In, MoreThan, Repository } from 'typeorm';
import { AccountType, LedgerAccount } from '../../entities/ledger-account.entity';
import { LedgerLeg } from '../../entities/ledger-leg.entity';
import { LedgerLegRepository } from '../../repositories/ledger-leg.repository';
import { LedgerAccountService } from '../ledger-account.service';
import { LedgerBookingService, LedgerLegInput } from '../ledger-booking.service';
import { LedgerMarkCache, LedgerMarkService } from '../ledger-mark.service';
import { getLedgerWatermark, setLedgerWatermark } from './ledger-watermark.helper';

const OK_STATUS = 'ok';
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
    const source = 'exchange_tx';
    const watermark = (await getLedgerWatermark(this.settingService, source)) ?? {
      lastProcessedId: 0,
      lastReversalScan: new Date(0),
    };

    const batch = await this.exchangeTxRepo.find({
      where: { id: MoreThan(watermark.lastProcessedId), status: OK_STATUS },
      order: { id: 'ASC' },
      take: Config.ledger.backfillBatchSize,
    });
    if (!batch.length) return;

    const times = batch.map((tx) => (tx.externalCreated ?? tx.created).getTime());
    const marks = await this.markService.preload(new Date(Math.min(...times)), new Date(Math.max(...times)));
    const fillIndexMap = await this.buildFillIndexMap(batch);

    let lastProcessedId = watermark.lastProcessedId;
    for (const tx of batch) {
      try {
        await this.book(tx, marks, fillIndexMap);
        lastProcessedId = tx.id;
      } catch (e) {
        this.logger.error(`Failed to book exchange_tx ${tx.id}`, e);
        break; // failure-isolation: leave watermark unchanged, retry next run (§4-header)
      }
    }

    if (lastProcessedId > watermark.lastProcessedId) {
      await setLedgerWatermark(this.settingService, source, { ...watermark, lastProcessedId });
    }
  }

  private async book(tx: ExchangeTx, marks: LedgerMarkCache, fillIndexMap: Map<number, number>): Promise<void> {
    const bookingDate = tx.externalCreated ?? tx.created;

    switch (tx.type) {
      case ExchangeTxType.DEPOSIT:
        return this.bookDeposit(tx, bookingDate, marks);
      case ExchangeTxType.WITHDRAWAL:
        return this.bookWithdrawal(tx, bookingDate, marks);
      case ExchangeTxType.TRADE:
        return this.bookTrade(tx, bookingDate, marks, fillIndexMap);
      default:
        this.logger.error(`Unhandled exchange_tx type ${tx.type} on exchange_tx ${tx.id}`);
    }
  }

  // §4.3/§4.3a — Deposit: Dr ASSET/{exchange}/{ccy} / Cr {routeCounterAccount}
  private async bookDeposit(tx: ExchangeTx, bookingDate: Date, marks: LedgerMarkCache): Promise<void> {
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

    await this.bookSingle(tx, bookingDate, [assetLeg, counterLeg]);
  }

  // §4.3/§4.3a — Withdrawal: Dr {routeCounterAccount} / Cr ASSET/{exchange}/{ccy} (mirror)
  private async bookWithdrawal(tx: ExchangeTx, bookingDate: Date, marks: LedgerMarkCache): Promise<void> {
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

    await this.bookSingle(tx, bookingDate, [counterLeg, assetLeg]);
  }

  // §4.3 — Trade: Dr ASSET/{exchange}/{base} / Cr ASSET/{exchange}/{quote} + spread + (ccxt) fee leg
  private async bookTrade(
    tx: ExchangeTx,
    bookingDate: Date,
    marks: LedgerMarkCache,
    fillIndexMap: Map<number, number>,
  ): Promise<void> {
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
      await this.bookSingle(tx, bookingDate, [
        { account: suspense, amount: chf, priceChf: 1, amountChf: chf },
        { account: suspense, amount: -chf, priceChf: 1, amountChf: -chf },
      ]);
      return;
    }

    const { base, quote, isBuy } = parsed;
    const baseAccount = await this.exchangeAssetByCcy(tx.exchange, base);
    const quoteAccount = await this.exchangeAssetByCcy(tx.exchange, quote);

    // base leg: +amount on buy / −amount on sell; CHF = persisted amountChf (Stufe 1) ?? mark
    const baseAmount = isBuy ? +tx.amount : -tx.amount;
    const baseChf = tx.amountChf ?? this.markValue(baseAccount, tx.amount, bookingDate, marks);
    const baseLeg: LedgerLegInput = {
      account: baseAccount,
      amount: baseAmount,
      priceChf: baseChf != null ? Util.round(Math.abs(baseChf) / Math.abs(tx.amount || 1), 8) : null,
      amountChf: baseChf != null ? (isBuy ? baseChf : -baseChf) : undefined,
      needsMark: baseChf == null,
    };

    const cost = tx.cost ?? 0;
    const quoteAmount = isBuy ? -cost : +cost;

    const legs: LedgerLegInput[] = [baseLeg];
    const isMarketSpreadFee = tx.exchange === ExchangeName.SCRYPT; // Scrypt feeAmountChf IS the market spread (§4.3)

    if (isMarketSpreadFee) {
      // Scrypt: ONE persisted spread leg = feeAmountChf (sign-aware), quote leg as plug (§4.3 variant i)
      const spreadChf = tx.feeAmountChf ?? 0;
      if (spreadChf !== 0) legs.push(await this.spreadLeg(tx.exchange, spreadChf));

      const plugChf = -legs.reduce((s, l) => s + (l.amountChf ?? 0), 0); // quote leg closes the tx
      const quotePrice = quoteAmount !== 0 ? Util.round(Math.abs(plugChf) / Math.abs(quoteAmount), 8) : null;
      legs.push({ account: quoteAccount, amount: quoteAmount, priceChf: quotePrice, amountChf: plugChf });
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

      // mark-based quote-spread leg: closes the base↔quote mark residual to 0 (sign-aware). Skip when a leg
      // still needsMark (no silent plug, §4.3) — mark-to-market revalues then.
      if (!legs.some((l) => l.needsMark)) {
        const residualChf = -legs.reduce((s, l) => s + (l.amountChf ?? 0), 0);
        const residualCents = Math.round(Util.round(residualChf, 2) * 100);
        if (Math.abs(residualCents) > Config.ledger.roundingToleranceCents) {
          legs.push(await this.spreadLeg(tx.exchange, residualChf));
        }
      }
    }

    const seq = fillIndexMap.get(tx.id) ?? 0;
    const order = tx.order;
    const sourceId = order ? `${order}` : `${tx.id}`;
    const sourceType = order ? 'ExchangeTrade' : 'exchange_tx';

    await this.bookingService.bookTx({
      sourceType,
      sourceId,
      seq: order ? seq : 0,
      bookingDate,
      valueDate: bookingDate,
      legs,
    });
  }

  // --- ROUTE DISAMBIGUATION (§4.3a/§4.3b) --- //

  // determines the route-passing counter account of a deposit/withdrawal (rein lesend, §4.3a)
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

  // rein lesend: a bank_tx KRAKEN/SCRYPT/SCB on the same currency within a date window (§4.3a-R2 nachgebaut)
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
    const existing = await this.exchangeTxRepo.find({
      where: { type: ExchangeTxType.TRADE, status: OK_STATUS, order: In(orders) },
      select: { id: true, exchange: true, order: true },
    });

    const byKey = Util.groupByAccessor<{ id: number; exchange: string; order?: string }, string>(
      existing,
      (e) => `${e.exchange}|${e.order}`,
    );
    for (const rows of byKey.values()) {
      rows.sort((a, b) => a.id - b.id);
      rows.forEach((row, idx) => map.set(row.id, idx));
    }

    return map;
  }

  // --- HELPERS --- //

  private async bookSingle(tx: ExchangeTx, bookingDate: Date, legs: LedgerLegInput[]): Promise<void> {
    await this.bookingService.bookTx({
      sourceType: 'exchange_tx',
      sourceId: `${tx.id}`,
      seq: 0,
      bookingDate,
      valueDate: bookingDate,
      legs,
    });
  }

  // §4.3 amountChf null fallback (Minor R9-4): persisted amountChf (Stufe 1) ?? mark × amount (Stufe 2) ?? needsMark
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
    if (!account) throw new Error(`ledger account ${exchange}/${ccy} not found (CoA bootstrap missing)`);
    return account;
  }

  // trade base/quote via symbol+side (not null-pair); reuse dashboard-reconciliation parse logic (nachgebaut, §4.3)
  private parseSymbol(tx: ExchangeTx): { base: string; quote: string; isBuy: boolean } | undefined {
    if (!tx.symbol || !tx.side) return undefined;
    const parts = tx.symbol.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
    return { base: parts[0], quote: parts[1], isBuy: tx.side.toLowerCase() === 'buy' };
  }
}
