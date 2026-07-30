import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { GetConfig } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AsyncSubscription } from 'src/shared/utils/async-field';
import { Util } from 'src/shared/utils/util';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PricingProvider } from 'src/subdomains/supporting/pricing/services/integration/pricing-provider';
import {
  ScryptBalance,
  ScryptBalanceTransaction,
  ScryptCancellation,
  ScryptDepositStatus,
  ScryptExecutionReport,
  ScryptMarketDataSnapshot,
  ScryptOrderBook,
  ScryptOrderInfo,
  ScryptOrderResponse,
  ScryptOrderSide,
  ScryptOrderStatus,
  ScryptOrderType,
  ScryptSecurity,
  ScryptTimeInForce,
  ScryptTrade,
  ScryptTransactionStatus,
  ScryptTransactionType,
  ScryptWithdrawResponse,
  ScryptWithdrawStatus,
} from '../dto/scrypt.dto';
import { TradeChangedException } from '../exceptions/trade-changed.exception';
import {
  isVenueRejection,
  ScryptAmendRejectedError,
  ScryptMessageType,
  ScryptOrderNotFoundError,
  ScryptUnconfirmedWriteError,
  ScryptVenueRejectionError,
  ScryptWebSocketConnection,
} from './scrypt-websocket-connection';

/**
 * After this long without a usable answer, an order the venue once acknowledged is treated as lost rather
 * than merely slow. Shared by the "cannot be found" and the "stuck pending" paths so both give up together.
 */
const ORDER_LOST_AFTER_MINUTES = 60;

// The venue answers a refused cancel with an execution report rather than a separate reject message, so the
// refusal has to be read off these two fields. `UnknownOrder` is the one reason treated as settling
// anything.
//
// That reading is an inference, not a documented guarantee — the protocol spec lists the reason without
// defining it, so "never existed" cannot be distinguished from "not processed yet" from the value alone.
// What it rests on: the caller only cancels an order that has already failed a status lookup and has
// outlived the window in which its request could still be in flight. Note what that does and does not
// cover — the lookup stops at the first reference the venue does not show, so for every other reference of
// the same order this refusal is the only negative answer there is. Age plus one refusal is the strongest
// evidence this protocol offers. Every other reason (too late, rate limited, already pending) settles
// nothing and is waited out.
const SCRYPT_CANCEL_REJECTED = 'CancelRejected';
const SCRYPT_UNKNOWN_ORDER = 'UnknownOrder';

// The bulk streams a reconnect catch-up restores; the live subscriptions cover everything else.
type CatchUpStream = ScryptMessageType.EXECUTION_REPORT | ScryptMessageType.BALANCE_TRANSACTION;

@Injectable()
export class ScryptService extends PricingProvider {
  private readonly logger = new DfxLogger(ScryptService);
  private readonly connection: ScryptWebSocketConnection;

  // Subscriptions (undefined when Scrypt is not configured, see constructor)
  private readonly securities?: AsyncSubscription<ScryptSecurity[]>;
  private readonly balances?: AsyncSubscription<Map<string, ScryptBalance>>;
  private readonly executionReports: Map<string, ScryptExecutionReport> = new Map();
  private readonly balanceTransactions: Map<string, ScryptBalanceTransaction> = new Map();
  private catchUpInProgress = false;
  private catchUpPending = false;
  private lastCatchUpAt?: number;
  private catchUpFailures = 0;
  private catchUpRetryTimer?: NodeJS.Timeout;

  // A catch-up round re-fetches each owed bulk stream in full, so its cost scales with the account history, not
  // with the length of the outage it repairs. On a socket that keeps dropping these must not chain back to back.
  // The interval is deliberately far above the observed drop cadence of a flapping connection (tens of seconds),
  // because that is the regime it has to bound; an isolated reconnect long after the last round waits not at all.
  private readonly catchUpMinInterval = 300000; // 5 min — min wall-clock between rounds, however many reconnects
  private readonly catchUpMaxRounds = 3; // rounds per invocation; leftover work is retried by a scheduled re-entry
  private readonly catchUpStreams: CatchUpStream[] = [
    ScryptMessageType.EXECUTION_REPORT,
    ScryptMessageType.BALANCE_TRANSACTION,
  ];

  // Keyed by stream rather than a switch, so adding one to catchUpStreams without a fetcher is a build error
  // instead of a leg that silently reports itself as caught up without ever fetching.
  private readonly catchUpFetchers: Record<CatchUpStream, () => Promise<void>> = {
    [ScryptMessageType.EXECUTION_REPORT]: async () =>
      this.applyExecutionReports(
        await this.connection.fetchAll<ScryptExecutionReport>(ScryptMessageType.EXECUTION_REPORT),
      ),
    [ScryptMessageType.BALANCE_TRANSACTION]: async () =>
      this.applyBalanceTransactions(
        await this.connection.fetchAll<ScryptBalanceTransaction>(ScryptMessageType.BALANCE_TRANSACTION),
      ),
  };

  readonly name: string = 'Scrypt';

  get isConfigured(): boolean {
    const { apiKey, apiSecret } = GetConfig().scrypt;
    return !!apiKey && !!apiSecret;
  }

  constructor() {
    super();

    const config = GetConfig().scrypt;
    this.connection = new ScryptWebSocketConnection(config.wsUrl, config.apiKey, config.apiSecret);

    // Skip the eager websocket connect + cache warm-up where Scrypt is unconfigured
    // (e.g. dev): the connection would otherwise reconnect-loop on ETIMEDOUT.
    if (!this.isConfigured) {
      this.logger.warn('Scrypt is not configured — skipping websocket subscriptions and cache warm-up');
      return;
    }

    // Securities subscription
    this.securities = new AsyncSubscription((cb) => {
      this.connection.subscribeToStream<ScryptSecurity>(ScryptMessageType.SECURITY, cb);
    });

    // Balances subscription (accumulate into Map)
    this.balances = new AsyncSubscription((cb) => {
      const map = new Map<string, ScryptBalance>();
      this.connection.subscribeToStream<ScryptBalance>(ScryptMessageType.BALANCE, (balances) => {
        for (const b of balances) map.set(b.Currency, b);
        cb(map);
      });
    });

    // ExecutionReport subscription (all pages + subscription)
    const executionWarmUp = this.connection
      .fetchAll<ScryptExecutionReport>(ScryptMessageType.EXECUTION_REPORT)
      .then((reports) => {
        this.applyExecutionReports(reports);
        return true;
      })
      .catch((error) => {
        this.logger.error('Failed to fetch execution reports:', error);
        return false;
      });

    this.connection.subscribeToStream<ScryptExecutionReport>(ScryptMessageType.EXECUTION_REPORT, (reports) => {
      for (const r of reports) this.cacheExecutionReport(r); // live event: always cache (terminal guard only, no age cutoff)
    });

    // BalanceTransaction subscription (all pages + subscription)
    const balanceWarmUp = this.connection
      .fetchAll<ScryptBalanceTransaction>(ScryptMessageType.BALANCE_TRANSACTION)
      .then((transactions) => {
        this.applyBalanceTransactions(transactions);
        return true;
      })
      .catch((error) => {
        this.logger.error('Failed to fetch balance transactions:', error);
        return false;
      });

    this.connection.subscribeToStream<ScryptBalanceTransaction>(
      ScryptMessageType.BALANCE_TRANSACTION,
      (transactions) => {
        for (const t of transactions) this.cacheBalanceTransaction(t); // live event: always cache (terminal guard only)
      },
    );

    // A warm-up that loaded BOTH streams is exactly what a catch-up round does, so it claims the first slot and a
    // reconnect right after boot waits it out instead of repeating it. If either leg failed the caches are not
    // whole, and the next reconnect must repair immediately rather than sit out the interval on stale state.
    void Promise.all([executionWarmUp, balanceWarmUp]).then(([executionLoaded, balanceLoaded]) => {
      if (executionLoaded && balanceLoaded) this.lastCatchUpAt = Date.now();
    });

    this.connection.onReconnect(() => this.catchUpAfterReconnect());
  }

  private isTerminalBalanceTransaction(t: ScryptBalanceTransaction): boolean {
    return (
      [ScryptTransactionStatus.FAILED, ScryptTransactionStatus.REJECTED].includes(t.Status) ||
      (t.Status === ScryptTransactionStatus.COMPLETED && !!t.TxHash)
    );
  }

  private cacheBalanceTransaction(t: ScryptBalanceTransaction): void {
    const existing = this.balanceTransactions.get(t.ClReqID);
    // Only apply the terminal guard for a real key: two distinct records that both lack a ClReqID collide under the
    // `undefined` key, so the guard must not suppress one for the other (fall back to last-write-wins as before).
    if (t.ClReqID && existing && this.isTerminalBalanceTransaction(existing) && !this.isTerminalBalanceTransaction(t))
      return;
    this.balanceTransactions.set(t.ClReqID, t);
  }

  private isTerminalExecutionReport(r: ScryptExecutionReport): boolean {
    return [ScryptOrderStatus.FILLED, ScryptOrderStatus.CANCELED, ScryptOrderStatus.REJECTED].includes(r.OrdStatus);
  }

  /**
   * Drop what we believe about an order, so the next lookup has to ask the venue.
   *
   * A non-terminal cached report is never replaced by a fetch, which is right while it is trustworthy and
   * wrong the moment an unconfirmed write may have changed the order underneath it.
   */
  private forgetExecutionReport(clOrdId: string): void {
    this.executionReports.delete(clOrdId);
  }

  private cacheExecutionReport(r: ScryptExecutionReport): void {
    const existing = this.executionReports.get(r.ClOrdID);
    if (existing && this.isTerminalExecutionReport(existing) && !this.isTerminalExecutionReport(r)) return;
    this.executionReports.set(r.ClOrdID, r);
  }

  // Bulk (age-bounded) warm-up/catch-up path only — live subscriptions must cache directly via cacheExecutionReport/cacheBalanceTransaction, see constructor.
  private applyExecutionReports(reports: ScryptExecutionReport[]): void {
    const cacheMaxAge = Util.daysBefore(365);
    for (const r of reports) if (!r.SubmitTime || new Date(r.SubmitTime) >= cacheMaxAge) this.cacheExecutionReport(r);
  }

  // Bulk (age-bounded) warm-up/catch-up path only — live subscriptions must cache directly via cacheExecutionReport/cacheBalanceTransaction, see constructor.
  private applyBalanceTransactions(transactions: ScryptBalanceTransaction[]): void {
    const cacheMaxAge = Util.daysBefore(365);
    for (const t of transactions) if (new Date(t.Timestamp) >= cacheMaxAge) this.cacheBalanceTransaction(t);
  }

  // After a WS reconnect, re-fetch balance transactions + execution reports so an event missed during the outage
  // is recovered (a bare re-subscribe is not documented to replay it). Mirrors the constructor warm-up's fetchAll,
  // but not its subscribeToStream (resubscription is handled by the reconnect itself). Best-effort; logs on failure.
  //
  // Rate-limited on purpose: the previous version re-ran a round for every reconnect observed during the round,
  // which cannot converge once rounds take longer than the interval between drops — each round then re-arms
  // itself and the venue is re-fetched continuously. `catchUpMinInterval` spaces the rounds, `catchUpMaxRounds`
  // bounds one invocation and hands anything still owed to a scheduled retry, the legs run sequentially so only
  // one bulk fetch is on the socket at a time, and within an invocation a round re-fetches only the legs that
  // actually failed — unless a reconnect coalesced in, whose outage postdates the round's snapshots and
  // therefore owes both streams again (the scheduled retry likewise restarts from the full pair).
  private async catchUpAfterReconnect(): Promise<void> {
    if (this.catchUpInProgress) {
      this.catchUpPending = true; // coalesce: a following round picks it up, or the retry scheduled on exhaustion
      return;
    }

    this.clearCatchUpRetry(); // a live invocation supersedes a scheduled one
    this.catchUpInProgress = true;

    let outstanding = [...this.catchUpStreams];
    try {
      for (let round = 0; round < this.catchUpMaxRounds; round++) {
        await this.awaitCatchUpSlot(); // reconnects arriving during the wait only set catchUpPending

        // A coalesced reconnect covers an outage that postdates the last round's snapshots, so it needs BOTH
        // streams again — not just the legs an earlier round failed on. This has to sit where the flag is
        // consumed: `outstanding` alone carries the failed legs, never the pending reconnect.
        if (this.catchUpPending) outstanding = [...this.catchUpStreams];
        this.catchUpPending = false;

        outstanding = await this.runCatchUpRound(outstanding);
        // Stamped at the END of the round, so the gate is a cooldown: a round that outlasts the interval would
        // otherwise leave `wait <= 0` and let the next one start immediately — exactly the back-to-back
        // re-fetching this gate exists to prevent.
        this.lastCatchUpAt = Date.now();

        if (!outstanding.length) this.reportCatchUpSuccess();
        if (!outstanding.length && !this.catchUpPending) return; // state is fresh and nothing coalesced
      }
    } finally {
      this.catchUpInProgress = false;
      // The loop is bounded, so it can end with a leg still failing or a reconnect still uncovered. onReconnect
      // only fires on the NEXT drop, so if the socket stabilises right here nothing would ever repair the gap.
      if (outstanding.length || this.catchUpPending) this.scheduleCatchUpRetry(outstanding);
    }
  }

  private async awaitCatchUpSlot(): Promise<void> {
    if (this.lastCatchUpAt == null) return;

    const wait = this.catchUpMinInterval - (Date.now() - this.lastCatchUpAt);
    if (wait > 0) await Util.delay(wait);
  }

  private scheduleCatchUpRetry(outstanding: CatchUpStream[]): void {
    this.logger.warn(
      `Scrypt reconnect catch-up incomplete after ${this.catchUpMaxRounds} round(s)${
        outstanding.length ? ` (still owed: ${outstanding.join(', ')})` : ''
      } — retrying in ${this.catchUpMinInterval}ms`,
    );

    // Retries the full pair: by the time it fires both streams have moved on anyway. The rejection handler
    // mirrors fireReconnectCallbacks — this runs detached, so an escaping error would take the process down.
    this.catchUpRetryTimer = setTimeout(
      () => void this.catchUpAfterReconnect().catch((e) => this.logger.error('Scrypt catch-up retry failed:', e)),
      this.catchUpMinInterval,
    );
    this.catchUpRetryTimer.unref();
  }

  private clearCatchUpRetry(): void {
    if (!this.catchUpRetryTimer) return;

    clearTimeout(this.catchUpRetryTimer);
    this.catchUpRetryTimer = undefined;
  }

  // The legs are independent: a failing execution-report fetch must not cost us the balance transactions, and a
  // leg that already applied is not re-fetched by the next round of this invocation — unless a reconnect
  // coalesced in (see the pending check above). The scheduled retry always restarts from the full pair.
  // Returns the streams that are still owed.
  private async runCatchUpRound(streams: CatchUpStream[]): Promise<CatchUpStream[]> {
    const failed: CatchUpStream[] = [];

    for (const stream of streams) {
      try {
        await this.catchUpFetchers[stream]();
      } catch (e) {
        failed.push(stream);
        this.reportCatchUpFailure(stream, e);
      }
    }

    return failed;
  }

  // A failed leg is a real state gap — the missed events stay missed until a later round restores them — so it
  // stays ERROR rather than being downgraded. Its volume is bounded by the round gate rather than by suppressing
  // lines: at most one per leg per catchUpMinInterval, which keeps a persisting failure visible.
  private reportCatchUpFailure(stream: CatchUpStream, error: Error): void {
    this.catchUpFailures++;

    this.logger.error(
      `Scrypt reconnect catch-up (${stream}) failed, ${this.catchUpFailures} consecutive failure(s):`,
      error,
    );
  }

  private reportCatchUpSuccess(): void {
    if (this.catchUpFailures > 0)
      this.logger.info(`Scrypt reconnect catch-up succeeded after ${this.catchUpFailures} consecutive failure(s)`);

    this.catchUpFailures = 0;
  }

  // --- BALANCES --- //

  async getBalances(): Promise<{ total: Record<string, number>; available: Record<string, number> }> {
    const balances = await this.getBalancesSubscription();

    const total: Record<string, number> = {};
    const available: Record<string, number> = {};

    for (const balance of balances.values()) {
      const amount = parseFloat(balance.Amount) || 0;
      const availableAmount = parseFloat(balance.AvailableAmount) || amount;

      total[balance.Currency] = amount;
      available[balance.Currency] = availableAmount;
    }

    return { total, available };
  }

  async getAvailableBalance(currency: string): Promise<number> {
    const balances = await this.getBalancesSubscription();

    const balance = balances.get(currency);
    if (!balance) return 0;

    const amount = parseFloat(balance.Amount) || 0;
    return parseFloat(balance.AvailableAmount) || amount;
  }

  private getBalancesSubscription(): AsyncSubscription<Map<string, ScryptBalance>> {
    if (!this.balances) throw new Error(`${this.name} is not configured`);
    return this.balances;
  }

  // --- WITHDRAWALS --- //

  async withdrawFunds(
    currency: string,
    amount: number,
    address: string,
    memo?: string,
    // See placeOrder: the caller persists this before calling, so a timed-out withdrawal stays traceable.
    // Two withdrawals (205'589.77 USDT on 15.07.2026, 553'823.67 USDT on 20.07.2026) executed at the venue
    // while being recorded as failed here, because the generated id never left this stack frame.
    reservedClReqId?: string,
  ): Promise<ScryptWithdrawResponse> {
    const clReqId = reservedClReqId ?? randomUUID();

    const withdrawData = {
      Quantity: amount.toString(),
      Currency: currency,
      MarketAccount: 'default',
      RoutingInfo: {
        WalletAddress: address,
        Memo: memo ?? '',
        DestinationTag: '',
      },
      ClReqID: clReqId,
    };

    const transaction = await this.connection.requestAndWaitForUpdate<ScryptBalanceTransaction>(
      ScryptMessageType.NEW_WITHDRAW_REQUEST,
      [withdrawData],
      ScryptMessageType.BALANCE_TRANSACTION,
      (transactions) =>
        transactions.find((t) => t.ClReqID === clReqId && t.TransactionType === ScryptTransactionType.WITHDRAWAL) ??
        null,
      60000,
    );

    if (transaction.Status === ScryptTransactionStatus.REJECTED) {
      throw new ScryptVenueRejectionError(
        `Scrypt withdrawal rejected: ${transaction.RejectText ?? transaction.RejectReason ?? 'Unknown reason'}`,
      );
    }

    return {
      id: clReqId,
      status: transaction.Status,
    };
  }

  async getWithdrawalStatus(clReqId: string): Promise<ScryptWithdrawStatus | null> {
    const transaction = this.balanceTransactions.get(clReqId);

    if (!transaction || transaction.TransactionType !== ScryptTransactionType.WITHDRAWAL) return null;

    return {
      id: transaction.TransactionID,
      status: transaction.Status,
      txHash: transaction.TxHash,
      amount: parseFloat(transaction.Quantity) || undefined,
      rejectReason: transaction.RejectReason,
      rejectText: transaction.RejectText,
    };
  }

  // --- DEPOSITS --- //

  getDepositStatus(clReqId: string): ScryptDepositStatus | null {
    const transaction = this.balanceTransactions.get(clReqId);

    if (!transaction || transaction.TransactionType !== ScryptTransactionType.DEPOSIT) return null;

    return {
      id: transaction.TransactionID,
      status: transaction.Status,
      rejectReason: transaction.RejectReason,
      rejectText: transaction.RejectText,
    };
  }

  async sendDepositRequest(params: {
    currency: string;
    amount: number;
    reqId: string;
    timeStamp: Date;
    txHashes?: string[];
  }): Promise<void> {
    const depositData = {
      Currency: params.currency,
      ClReqID: params.reqId,
      Quantity: params.amount.toString(),
      TransactTime: params.timeStamp.toISOString(),
      TxHashes: (params.txHashes?.length ? params.txHashes : [params.reqId]).map((hash) => ({ TxHash: hash })),
    };

    await this.connection.send(ScryptMessageType.NEW_DEPOSIT_REQUEST, [depositData]);
  }

  // --- TRANSACTIONS --- //

  onBalanceTransactions(callback: (transactions: ScryptBalanceTransaction[]) => void): void {
    this.connection.subscribeToStream<ScryptBalanceTransaction>(ScryptMessageType.BALANCE_TRANSACTION, callback);
  }

  async getAllTransactions(since?: Date): Promise<ScryptBalanceTransaction[]> {
    const transactions = Array.from(this.balanceTransactions.values());
    return transactions.filter((t) => !since || (t.TransactTime && new Date(t.TransactTime) >= since));
  }

  private async fetchExecutionReports(since?: Date): Promise<ScryptExecutionReport[]> {
    const filters: Record<string, unknown> = {};
    if (since) filters.StartDate = since.toISOString();

    return this.connection.fetch<ScryptExecutionReport>(ScryptMessageType.EXECUTION_REPORT, filters);
  }

  async getTrades(since?: Date): Promise<ScryptTrade[]> {
    const filters: Record<string, unknown> = {};
    if (since) filters.StartDate = since.toISOString();

    return this.connection.fetch<ScryptTrade>(ScryptMessageType.TRADE, filters);
  }

  // --- TRADING --- //

  async getPrice(from: string, to: string): Promise<Price> {
    const { symbol, side } = await this.getTradePair(from, to);
    const price = await this.getOrderBookPrice(symbol, side);

    return Price.create(from, to, side === ScryptOrderSide.BUY ? price : 1 / price);
  }

  async getCurrentPrice(from: string, to: string): Promise<number> {
    const { symbol, side } = await this.getTradePair(from, to);
    const price = await this.getOrderBookPrice(symbol, side);

    return side === ScryptOrderSide.BUY ? price : 1 / price;
  }

  async sell(from: string, to: string, amount: number, reservedClOrdId?: string): Promise<string> {
    const { symbol, side } = await this.getTradePair(from, to);
    const price = await this.getOrderBookPrice(symbol, side);
    const sizeIncrement = await this.getSizeIncrement(symbol);

    // OrderQty must be in base currency
    // SELL (from=base): orderQty = amount
    // BUY (from=quote): orderQty = amount / price
    const rawQty = side === ScryptOrderSide.SELL ? amount : amount / price;
    const orderQty = Util.floorToValue(rawQty, sizeIncrement);

    return this.placeAndReturnId(symbol, side, orderQty, price, reservedClOrdId);
  }

  async buy(from: string, to: string, amount: number, reservedClOrdId?: string): Promise<string> {
    const { symbol, side } = await this.getTradePair(from, to);
    const price = await this.getOrderBookPrice(symbol, side);
    const sizeIncrement = await this.getSizeIncrement(symbol);

    // OrderQty must be in base currency
    // BUY (to=base): orderQty = amount
    // SELL (to=quote): orderQty = amount / price
    const rawQty = side === ScryptOrderSide.BUY ? amount : amount / price;
    const orderQty = Util.floorToValue(rawQty, sizeIncrement);

    return this.placeAndReturnId(symbol, side, orderQty, price, reservedClOrdId);
  }

  private async getSizeIncrement(symbol: string): Promise<number> {
    const security = await this.getSecurity(symbol);
    return parseFloat(security.MinSizeIncrement ?? '0.000001');
  }

  private async placeAndReturnId(
    symbol: string,
    side: ScryptOrderSide,
    orderQty: number,
    price: number,
    reservedClOrdId?: string,
  ): Promise<string> {
    const response = await this.placeOrder(
      symbol,
      side,
      orderQty,
      ScryptOrderType.LIMIT,
      ScryptTimeInForce.GOOD_TILL_CANCEL,
      price,
      reservedClOrdId,
    );
    return response.id;
  }

  /**
   * Reconciliation lookup: does the venue know this withdrawal reference at all?
   *
   * Distinct from `getWithdrawalStatus`, which answers from the live push cache only. After a timeout that
   * cache is exactly what cannot be trusted — the push may be what went missing — so this falls back to the
   * venue's own history. A `null` result therefore means "the venue has no record", not "we have not seen it".
   */
  async findWithdrawal(clReqId: string): Promise<ScryptBalanceTransaction | null> {
    const cached = this.balanceTransactions.get(clReqId);
    // A terminal record cannot change; a non-terminal one may be stale because the terminal push was the
    // thing that went missing, so it must not shortcut the lookup.
    if (cached && this.isTerminalBalanceTransaction(cached)) return cached;

    const transactions = await this.connection.fetchAll<ScryptBalanceTransaction>(
      ScryptMessageType.BALANCE_TRANSACTION,
    );

    const found = transactions.find((t) => t.ClReqID === clReqId);
    if (!found) return cached ?? null;

    // Feed the recovery back into the live cache. `getWithdrawalStatus` reads only from there, so an order
    // that leaves quarantine on the strength of this lookup would otherwise poll a reference the cache still
    // does not know and never complete.
    this.cacheBalanceTransaction(found);

    return found;
  }

  /**
   * Confirm that the venue's full transaction history has no record of this withdrawal reference.
   *
   * Scrypt has no cancel/storno operation for withdrawals. A quarantined withdrawal therefore cannot be
   * cleared the way a trade is (cancel every reference). The only safe automatic exit is confirmed absence:
   * the venue returned a complete history and this `clReqId` is not in it. That is weaker than "the request
   * never arrived" — it is only "nothing under this reference exists in a history we can trust" — and the
   * caller abandons on that basis rather than claiming a not-sent release.
   *
   * No cache shortcut is allowed. `findWithdrawal` may return a terminal cached row early because a positive
   * match answers "does this exist?". Here the question is the opposite — "is there demonstrably nothing?" —
   * and only a fresh, complete bulk fetch can answer that. A stale cache miss would be a guess.
   *
   * The consistency gate — not the age bound — is the safety barrier. Before concluding absence, every
   * cached transaction that falls inside the caller's window (or has no readable timestamp) must reappear in
   * the fresh response. Without that gate an incomplete or truncated reply that simply omits the sought
   * reference would be read as "does not exist", the order would be abandoned, and a later replan could call
   * `withdraw()` again. That path only checks `minAmount > balance` and then takes `min(maxAmount, balance)`,
   * so with enough remaining balance a second attempt goes through — a double payout. The gate exists to
   * make that impossible from an untrustworthy history.
   *
   * `since` only limits which *cached* rows the gate insists on seeing again: a venue that drops ancient
   * history must not permanently fail the gate on a long-irrelevant cached id, or the withdrawal would fall
   * back into endless silent quarantine. A failed gate always warns with the missing references named, so a
   * permanently broken fetch is visible rather than an invisible wait.
   *
   * @returns true only when the fresh history is non-empty, passes the consistency gate, and does not contain
   * `clReqId`. false on fetch failure, empty history, gate failure, or when the reference is present.
   */
  async confirmWithdrawalAbsent(clReqId: string, since: Date): Promise<boolean> {
    // Snapshot before the fetch: the gate asks whether rows we already knew still appear in the answer we
    // are about to trust. Reading the map after the await would mix in anything concurrent writers added
    // during the round-trip, which is not what "already stood in the cache before this fetch" means.
    const previouslyCached = [...this.balanceTransactions.values()];

    let fresh: ScryptBalanceTransaction[];
    try {
      fresh = await this.connection.fetchAll<ScryptBalanceTransaction>(ScryptMessageType.BALANCE_TRANSACTION);
    } catch (e) {
      this.logger.warn(`confirmWithdrawalAbsent(${clReqId}): could not fetch full transaction history: ${e.message}`);
      return false;
    }

    if (!fresh.length) {
      this.logger.warn(
        `confirmWithdrawalAbsent(${clReqId}): venue returned an empty transaction history — cannot conclude absence`,
      );
      return false;
    }

    const freshIds = new Set(fresh.map((t) => t.ClReqID).filter((id): id is string => Boolean(id)));

    const missingFromFresh: string[] = [];
    for (const cached of previouslyCached) {
      if (!cached.ClReqID) continue;

      // Spec-allowed field priority: Timestamp first, TransactTime only when Timestamp is missing. A missing
      // or unparseable stamp is never a reason to skip — those rows are always checked (conservative).
      const raw = cached.Timestamp ?? cached.TransactTime;
      if (raw) {
        const ts = new Date(raw);
        if (!Number.isNaN(ts.getTime()) && ts < since) continue;
      }

      if (!freshIds.has(cached.ClReqID)) missingFromFresh.push(cached.ClReqID);
    }

    // Gate first, independently of whether clReqId itself is missing. An incomplete answer that also lacks
    // the sought reference must not be upgraded to "confirmed absent".
    if (missingFromFresh.length) {
      this.logger.warn(
        `confirmWithdrawalAbsent(${clReqId}): consistency gate failed — cached references missing from fresh history: ${missingFromFresh.join(
          ', ',
        )}`,
      );
      return false;
    }

    return !freshIds.has(clReqId);
  }

  /**
   * @param since lower bound for the fallback history fetch. A caller that knows when its reference can
   * earliest have existed passes it here, so a lookup for an absent order does not pull a full 30 days of
   * execution reports over the connection. Defaults to the full 30-day window.
   */
  async getOrderStatus(clOrdId: string, since?: Date): Promise<ScryptOrderInfo | null> {
    // Try in-memory cache first
    let report = this.executionReports.get(clOrdId);

    // Fallback: fetch from Scrypt API (e.g. after restart or WS reconnect)
    if (!report) {
      const reports = await this.fetchExecutionReports(since ?? Util.daysBefore(30));
      const fetched = reports.find((r) => r.ClOrdID === clOrdId);

      if (fetched) {
        // Route through the terminal-aware guard: a live terminal push that arrived during the await
        // must not be clobbered by a stale non-terminal snapshot from this fallback fetch.
        this.cacheExecutionReport(fetched);
        report = this.executionReports.get(clOrdId);
      }
    }

    if (!report) return null;

    return {
      id: report.ClOrdID,
      orderId: report.OrderID,
      symbol: report.Symbol,
      side: report.Side,
      status: report.OrdStatus,
      quantity: parseFloat(report.OrderQty) || 0,
      filledQuantity: parseFloat(report.CumQty) || 0,
      remainingQuantity: parseFloat(report.LeavesQty) || 0,
      avgPrice: report.AvgPx ? parseFloat(report.AvgPx) : undefined,
      price: report.Price ? parseFloat(report.Price) : undefined,
      rejectReason: report.OrdRejReason ?? report.Text,
    };
  }

  /**
   * @param replacementClOrdId reference to use if this check has to amend or restart the order. Must be
   * reproducible from the order row by the caller, so a timed-out replacement stays findable.
   */
  async checkTrade(
    clOrdId: string,
    from: string,
    to: string,
    orderCreated?: Date,
    replacementClOrdId?: string,
    // Invoked immediately before a replacement is sent, so the caller can make the reference durable first.
    // Without that, a replacement whose confirmation is lost is neither the current reference nor a spent
    // one, and the next pass derives it a second time.
    claimReplacement?: () => Promise<void>,
  ): Promise<boolean> {
    const orderInfo = await this.getOrderStatus(clOrdId);
    if (!orderInfo) {
      // If the order is older than 1 hour and still not found, it's lost
      const ageMinutes = orderCreated ? Util.minutesDiff(orderCreated) : 0;
      if (ageMinutes > ORDER_LOST_AFTER_MINUTES) {
        throw new ScryptOrderNotFoundError(
          `Order ${clOrdId} not found after ${Math.round(ageMinutes)} minutes — it may have completed or been cancelled outside of tracked state`,
        );
      }

      this.logger.verbose(`No order info for id ${clOrdId} at ${this.name} found`);
      return false;
    }

    switch (orderInfo.status) {
      case ScryptOrderStatus.NEW:
      case ScryptOrderStatus.PARTIALLY_FILLED: {
        const currentPrice = await this.getTradePrice(from, to);

        // Use tolerance for float comparison to avoid unnecessary updates due to rounding
        const priceChanged = orderInfo.price && Math.abs(currentPrice - orderInfo.price) > 0.000001;
        if (priceChanged) {
          this.logger.verbose(`Order ${clOrdId}: price changed ${orderInfo.price} -> ${currentPrice}, updating order`);

          try {
            await claimReplacement?.();

            const newId = await this.editOrder(
              clOrdId,
              from,
              to,
              orderInfo.remainingQuantity,
              currentPrice,
              replacementClOrdId,
            );
            this.logger.verbose(`Order ${clOrdId} changed to ${newId}`);
            throw new TradeChangedException(newId);
          } catch (e) {
            if (e instanceof TradeChangedException) throw e;

            // The amend is a write. Unless the venue explicitly rejected it, we do not know whether a
            // replacement order now exists under `replacementClOrdId` — cancelling and carrying on would
            // leave it live and untracked, which is how an amend turns into a duplicate position.
            if (!isVenueRejection(e))
              throw new ScryptUnconfirmedWriteError(
                `Scrypt gave no confirmed outcome for the amend of order ${clOrdId}: ${e.message}`,
                replacementClOrdId,
              );

            // Rejected by the venue: nothing was created, so the cancel-and-restart fallback is safe.
            this.logger.verbose(`Could not update order ${clOrdId}, attempting cancel: ${e.message}`);
            let cancelConfirmed = true;
            try {
              const cancelReport = await this.cancelOrder(clOrdId, from, to);
              cancelConfirmed = cancelReport.OrdStatus === ScryptOrderStatus.CANCELED;
            } catch (cancelError) {
              // The cancel is a write too. Unconfirmed, it may well have taken effect at the venue while the
              // cached report still shows the order open — and a non-terminal entry is never refreshed, so
              // every later check would keep waiting on a picture that cannot change. Drop it instead and
              // let the next lookup ask the venue.
              cancelConfirmed = false;
              this.forgetExecutionReport(clOrdId);
              this.logger.warn(`Cancel of order ${clOrdId} went unconfirmed: ${cancelError.message}`);
            }

            // Surface the refusal so the caller can note the spent reference. Without that the next tick
            // derives the very same one, the venue refuses it as a duplicate, and the pair loops.
            throw new ScryptAmendRejectedError(
              `Scrypt refused the amend of order ${clOrdId}: ${e.message}` +
                (cancelConfirmed ? '' : ' (the follow-up cancel went unconfirmed)'),
              replacementClOrdId,
            );
          }
        } else {
          this.logger.verbose(`Order ${clOrdId} open, price is still ${currentPrice}`);
        }
        return false;
      }

      case ScryptOrderStatus.CANCELED: {
        const minAmount = await this.getMinTradeAmount(from, to);
        const remaining = orderInfo.remainingQuantity;

        // If remaining amount is below minimum, consider complete
        if (remaining < minAmount) {
          this.logger.verbose(
            `Order ${clOrdId} cancelled with remaining ${remaining} < minAmount ${minAmount}, marking complete`,
          );
          return true;
        }

        // Restart order with remaining amount (already in base currency)
        const { symbol, side } = await this.getTradePair(from, to);
        const price = await this.getOrderBookPrice(symbol, side);

        this.logger.verbose(`Order ${clOrdId} cancelled, restarting with remaining ${remaining} (base currency)`);

        await claimReplacement?.();

        // Same write boundary as the amend above: an unconfirmed restart may have created a live order under
        // `replacementClOrdId`, so the caller has to quarantine rather than see a retryable transport error.
        const response = await this.placeOrder(
          symbol,
          side,
          remaining,
          ScryptOrderType.LIMIT,
          ScryptTimeInForce.GOOD_TILL_CANCEL,
          price,
          replacementClOrdId,
        ).catch((e) => {
          if (isVenueRejection(e)) throw e;

          throw new ScryptUnconfirmedWriteError(
            `Scrypt gave no confirmed outcome for the restart of order ${clOrdId}: ${e.message}`,
            replacementClOrdId,
          );
        });

        this.logger.verbose(`Order ${clOrdId} changed to ${response.id}`);
        throw new TradeChangedException(response.id);
      }

      case ScryptOrderStatus.FILLED:
        this.logger.verbose(`Order ${clOrdId} filled`);
        return true;

      case ScryptOrderStatus.REJECTED:
        throw new ScryptVenueRejectionError(
          `Order ${clOrdId} has been rejected: ${orderInfo.rejectReason ?? 'unknown reason'}`,
        );

      case ScryptOrderStatus.PENDING_NEW:
      case ScryptOrderStatus.PENDING_CANCEL:
      case ScryptOrderStatus.PENDING_REPLACE:
        // Deliberately just waits, however old the order is. A pending report is an OBSERVATION — we know
        // where the order stands — so it is not an unknown outcome and must not be quarantined: reconciliation
        // would find the reference, hand the order straight back, and the next completion check would
        // quarantine it again. An order that stays pending too long is a stuck order, which the monitoring
        // counter surfaces; it is not an unresolved one.
        this.logger.verbose(`Order ${clOrdId} is pending (${orderInfo.status}), waiting...`);
        return false;
    }
  }

  private async getTradePrice(from: string, to: string): Promise<number> {
    const { symbol, side } = await this.getTradePair(from, to);
    return this.getOrderBookPrice(symbol, side);
  }

  private async getMinTradeAmount(from: string, to: string): Promise<number> {
    const { symbol } = await this.getTradePair(from, to);
    const security = await this.getSecurity(symbol);
    return parseFloat(security.MinimumSize ?? '0');
  }

  private async placeOrder(
    symbol: string,
    side: ScryptOrderSide,
    quantity: number,
    orderType: ScryptOrderType = ScryptOrderType.LIMIT,
    timeInForce: ScryptTimeInForce = ScryptTimeInForce.GOOD_TILL_CANCEL,
    price?: number,
    // Caller-supplied reference, persisted by the caller BEFORE this call. Without it the id only exists on
    // the stack and is lost on timeout — leaving a possibly live venue order nobody can look up. Falls back
    // to a fresh id so ad-hoc callers keep working; the venue requires daily uniqueness and <36 chars.
    reservedClOrdId?: string,
  ): Promise<ScryptOrderResponse> {
    const clOrdId = reservedClOrdId ?? randomUUID();

    // Price is required for LIMIT orders
    if (orderType === ScryptOrderType.LIMIT && price === undefined) {
      throw new Error('Price is required for LIMIT orders');
    }

    const orderData: Record<string, unknown> = {
      Symbol: symbol,
      ClOrdID: clOrdId,
      Side: side,
      OrderQty: quantity.toString(),
      OrdType: orderType,
      TimeInForce: timeInForce,
    };

    if (price !== undefined) {
      orderData.Price = price.toString();
    }

    const report = await this.connection.requestAndWaitForUpdate<ScryptExecutionReport>(
      ScryptMessageType.NEW_ORDER_SINGLE,
      [orderData],
      ScryptMessageType.EXECUTION_REPORT,
      (reports) => reports.find((r) => r.ClOrdID === clOrdId) ?? null,
      60000,
    );

    if (report.OrdStatus === ScryptOrderStatus.REJECTED) {
      throw new ScryptVenueRejectionError(
        `Scrypt order rejected: ${report.Text ?? report.OrdRejReason ?? 'Unknown reason'}`,
      );
    }

    return {
      id: clOrdId,
      status: report.OrdStatus,
    };
  }

  /**
   * Ask the venue to make sure a reference cannot execute any more, and report what that established.
   *
   * For giving up on an order whose outcome was never observed. The danger there is never the order itself
   * but a request still live in the book: hand the funds back to a rule while one sits open and a late fill
   * spends them twice. Cancelling removes that possibility outright, which beats estimating when it has
   * passed — and unlike a re-send, a cancel can never create anything.
   *
   * Three outcomes, because a cancel does not only ever mean "nothing happened":
   *  - SETTLED — terminal with nothing filled (cancelled or rejected), or the venue does not know the
   *    reference at all. Both mean nothing can execute under it, which is what lets the caller give the
   *    order up — the first outright, the second as an inference from the venue's own words rather than a
   *    statement about execution. See SCRYPT_UNKNOWN_ORDER for what that inference rests on.
   *  - EXECUTED — it reached a terminal state with something filled. Like a cancelled reference it cannot
   *    trade further, so the caller may give the order up; the fill has already moved the venue balance
   *    that the rule replans from. Reported separately from SETTLED because "something happened here" is
   *    worth seeing in a log and worth reconciling against.
   *
   *    Terminal is the operative word: a refused cancel carries the order's last known state, so a
   *    partially filled order that could NOT be cancelled reports a fill while staying wide open.
   *  - UNCONFIRMED — no usable answer. Nothing may be concluded from it.
   */
  async cancelIfOutstanding(clOrdId: string, from: string, to: string): Promise<ScryptCancellation> {
    try {
      const report = await this.cancelOrder(clOrdId, from, to);

      const filled = Number(report.CumQty);

      // An unreadable quantity is not a zero one. Concluding "nothing filled" from a value that could not
      // be parsed is exactly how a real fill gets dropped, so it settles nothing and the caller waits.
      //
      // Emptiness has to be caught separately: Number('') and Number('   ') are 0, not NaN, so a missing
      // quantity would otherwise pass the finite check and read as an untouched order. A negative one is
      // rejected for the same reason rather than compared away: a cumulative filled size cannot be below
      // zero, so a venue reporting one is not describing an untouched order — it is not being understood,
      // and only the checks below would quietly treat it as though nothing had traded.
      if (!report.CumQty?.trim() || !Number.isFinite(filled) || filled < 0) {
        this.logger.warn(`Cancel of order ${clOrdId} reported an unreadable filled size (${report.CumQty})`);

        return ScryptCancellation.UNCONFIRMED;
      }

      const refusedAsUnknown =
        report.ExecType === SCRYPT_CANCEL_REJECTED && report.CxlRejReason === SCRYPT_UNKNOWN_ORDER;

      // Checked before anything else: a report claiming the venue has no record of this order while
      // reporting a fill on it disagrees with itself, and that is true whatever its status says. Deciding
      // on the status first would let the same contradiction through with a terminal one attached.
      if (refusedAsUnknown && filled > 0) {
        this.logger.warn(
          `Cancel of order ${clOrdId} was refused as unknown yet reports ${report.CumQty} filled — the report contradicts itself, settling nothing`,
        );

        return ScryptCancellation.UNCONFIRMED;
      }

      // Only a terminal state answers the question this method asks. A refused cancel comes back carrying
      // the order's LAST KNOWN state, so a partially filled order that could not be cancelled reports a
      // fill while remaining wide open — reading the fill alone would call that finished and let the
      // caller walk away from a reference that can still trade.
      //
      // Which states are terminal is decided in one place for this venue, not restated here: a rejected
      // order is just as final as a cancelled one, and a second list would be free to disagree with the
      // first — leaving an order that provably cannot trade stuck for want of being recognised.
      if (this.isTerminalExecutionReport(report)) {
        if (filled > 0) {
          this.logger.warn(
            `Cancel of order ${clOrdId} came back terminal with ${report.CumQty} already filled — it executed, and the fill has to be reconciled against the venue balance`,
          );

          return ScryptCancellation.EXECUTED;
        }

        return ScryptCancellation.SETTLED;
      }

      // The venue does not know this reference. Taken together with the order's age and its failed status
      // lookup, that is treated as settled — see SCRYPT_UNKNOWN_ORDER for what that evidence covers and
      // why it is an inference rather than a guarantee.
      if (refusedAsUnknown) {
        this.logger.verbose(`Scrypt has no such order to cancel for ${clOrdId}`);

        return ScryptCancellation.SETTLED;
      }

      this.logger.warn(
        `Cancel of order ${clOrdId} left it in state ${report.OrdStatus}${
          report.CxlRejReason ? ` (${report.CxlRejReason})` : ''
        } — nothing settled`,
      );

      return ScryptCancellation.UNCONFIRMED;
    } catch (e) {
      // No rejection branch here on purpose: this venue answers a refused cancel with an execution report,
      // not an exception, and that is read above. What reaches this catch is anything that stopped the cancel
      // from being answered — the trade-pair lookup it starts with, or the send and its wait.
      //
      // Not all of those got as far as writing, but this cannot tell which did, and that is the whole reason
      // to treat them alike: an unconfirmed cancel may have taken effect at the venue while the cached report
      // still shows the order open, and a non-terminal entry is never refreshed, so every later check would
      // wait on a picture that cannot change. Dropping it costs one lookup when nothing was ever sent, and
      // avoids a permanently stale one when something was.
      this.forgetExecutionReport(clOrdId);
      this.logger.warn(`Cancel of order ${clOrdId} went unconfirmed: ${e.message}`);

      return ScryptCancellation.UNCONFIRMED;
    }
  }

  private async cancelOrder(clOrdId: string, from: string, to: string): Promise<ScryptExecutionReport> {
    const { symbol } = await this.getTradePair(from, to);
    const newClOrdId = randomUUID();

    const cancelData = {
      OrigClOrdID: clOrdId,
      ClOrdID: newClOrdId,
      Symbol: symbol,
    };

    const report = await this.connection.requestAndWaitForUpdate<ScryptExecutionReport>(
      ScryptMessageType.ORDER_CANCEL_REQUEST,
      [cancelData],
      ScryptMessageType.EXECUTION_REPORT,
      // PendingCancel is the venue saying "working on it", not an answer. Taking the first report that
      // merely mentions this order would freeze that intermediate state as the result — and since the
      // waiter unsubscribes on its first match, the real terminal report that follows would never be seen.
      (reports) =>
        reports.find(
          (r) =>
            (r.OrigClOrdID === clOrdId || r.ClOrdID === newClOrdId) && r.OrdStatus !== ScryptOrderStatus.PENDING_CANCEL,
        ) ?? null,
      60000,
    );

    // Deliberately not cached under the cancelled order's own id. The venue tags a cancel confirmation with
    // the CANCEL request's id, so filing it under the order would make a later status lookup read that
    // order as terminally cancelled — and a cleanup cancellation says nothing about the order as a whole:
    // its sibling references may still be unsettled and live. A lookup that then reports the order as known
    // would take it out of quarantine and let the completion check open a replacement beside them, which is
    // the double execution this path exists to prevent.

    return report;
  }

  private async editOrder(
    clOrdId: string,
    from: string,
    to: string,
    newQuantity: number,
    newPrice: number,
    // See placeOrder. A cancel-replace creates a NEW venue order, so its reference needs the same
    // reproducibility as the initial one — otherwise an amend that times out leaves a live order that
    // nothing can look up.
    reservedClOrdId?: string,
  ): Promise<string> {
    const { symbol } = await this.getTradePair(from, to);
    const newClOrdId = reservedClOrdId ?? randomUUID();

    const editData = {
      OrigClOrdID: clOrdId,
      ClOrdID: newClOrdId,
      Symbol: symbol,
      OrderQty: newQuantity.toString(),
      Price: newPrice.toString(),
    };

    const report = await this.connection.requestAndWaitForUpdate<ScryptExecutionReport>(
      ScryptMessageType.ORDER_CANCEL_REPLACE_REQUEST,
      [editData],
      ScryptMessageType.EXECUTION_REPORT,
      (reports) => reports.find((r) => r.ClOrdID === newClOrdId) ?? null,
      60000,
    );

    if (report.OrdStatus === ScryptOrderStatus.REJECTED) {
      throw new ScryptVenueRejectionError(
        `Scrypt order edit rejected: ${report.Text ?? report.OrdRejReason ?? 'Unknown reason'}`,
      );
    }

    return newClOrdId;
  }

  // --- MARKET DATA --- //

  async getTradePair(from: string, to: string): Promise<{ symbol: string; side: ScryptOrderSide }> {
    const securities = await this.getSecuritiesSubscription();

    // Find matching pair: either from=base,to=quote (SELL base) or from=quote,to=base (BUY base)
    const security = securities.find(
      (s) => (s.BaseCurrency === from && s.QuoteCurrency === to) || (s.BaseCurrency === to && s.QuoteCurrency === from),
    );

    if (!security) {
      throw new Error(`${this.name}: pair with ${from} and ${to} not supported`);
    }

    // If 'from' is the base currency, we're selling the base; otherwise buying the base
    const side = security.BaseCurrency === from ? ScryptOrderSide.SELL : ScryptOrderSide.BUY;

    return { symbol: security.Symbol, side };
  }

  private async getSecurity(symbol: string): Promise<ScryptSecurity> {
    const securities = await this.getSecuritiesSubscription();
    const security = securities.find((s) => s.Symbol === symbol);

    if (!security) {
      throw new Error(`No security info for symbol ${symbol}`);
    }

    return security;
  }

  private getSecuritiesSubscription(): AsyncSubscription<ScryptSecurity[]> {
    if (!this.securities) throw new Error(`${this.name} is not configured`);
    return this.securities;
  }

  private async getOrderBookPrice(symbol: string, side: ScryptOrderSide): Promise<number> {
    const orderBook = await this.fetchOrderBook(symbol);

    // BUY: look at offers (what sellers are asking) - best ask (lowest offer)
    // SELL: look at bids (what buyers are offering) - best bid (highest bid)
    const orders = side === ScryptOrderSide.BUY ? orderBook.offers : orderBook.bids;
    if (!orders.length)
      throw new Error(`No ${side === ScryptOrderSide.BUY ? 'offers' : 'bids'} available for ${symbol}`);

    return orders[0].price;
  }

  private async fetchOrderBook(symbol: string): Promise<ScryptOrderBook> {
    const snapshots = await this.connection.fetch<ScryptMarketDataSnapshot>(ScryptMessageType.MARKET_DATA_SNAPSHOT, {
      Symbol: symbol,
    });
    const snapshot = snapshots[0];

    if (!snapshot) {
      throw new Error(`No orderbook data for symbol ${symbol}`);
    }

    return {
      bids: snapshot.Bids.map((b) => ({ price: parseFloat(b.Price), size: parseFloat(b.Size) })),
      offers: snapshot.Offers.map((o) => ({ price: parseFloat(o.Price), size: parseFloat(o.Size) })),
    };
  }
}
