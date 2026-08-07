import { BadRequestException, Inject, OnModuleInit } from '@nestjs/common';
import BigNumber from 'bignumber.js';
import {
  Balance,
  Balances,
  ConstructorArgs,
  Currencies,
  Dictionary,
  Exchange,
  Market,
  Order,
  OrderBook,
  Trade,
  Transaction,
  WithdrawalResponse,
} from 'ccxt';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { Util } from 'src/shared/utils/util';
import { PricingProvider } from 'src/subdomains/supporting/pricing/services/integration/pricing-provider';
import { Price } from '../../../subdomains/supporting/pricing/domain/entities/price';
import { TradeChangedException } from '../exceptions/trade-changed.exception';
import { ExchangeRegistryService } from './exchange-registry.service';

export enum OrderSide {
  BUY = 'buy',
  SELL = 'sell',
}

/**
 * Amounts a venue accepts in a single withdrawal. A field is undefined when the venue publishes no such limit
 * or the query failed — an unknown limit is never the same as a limit of zero.
 */
export interface WithdrawalLimits {
  min?: number;
  max?: number;
}

/**
 * One entry of `currency.networks`, which ccxt types as `any`. The limits are typed as `unknown` on purpose:
 * ccxt builds them per network with `safeString` and parses only the token-level aggregate into a number, so
 * what arrives here is a string on the venues that publish per-network limits at all.
 */
interface CurrencyNetwork {
  id?: string;
  network?: string;
  info?: { netWork?: string; network?: string };
  limits?: { withdraw?: { min?: unknown; max?: unknown } };
}

enum OrderStatus {
  OPEN = 'open',
  CLOSED = 'closed',
  CANCELED = 'canceled',
}

enum PrecisionMode {
  DECIMAL_PLACES = 0,
  SIGNIFICANT_DIGITS = 2,
  TICK_SIZE = 4,
}

export abstract class ExchangeService extends PricingProvider implements OnModuleInit {
  protected abstract readonly logger: DfxLogger;

  protected abstract readonly networks: { [b in Blockchain]: string | false };
  protected readonly exchange: Exchange;

  private markets: Market[];
  private readonly currenciesCache = new AsyncCache<Currencies>(CacheItemResetPeriod.EVERY_HOUR);

  @Inject() private readonly registry: ExchangeRegistryService;

  constructor(
    exchange: { new (userConfig: ConstructorArgs): Exchange },
    public readonly config: ConstructorArgs,
    private readonly queue?: QueueHandler,
  ) {
    super();

    this.queue ??= new QueueHandler(180000, 60000);
    this.exchange = new exchange(config);
  }

  onModuleInit() {
    this.registry.add(this.name, this);
  }

  get name(): string {
    return this.exchange.name;
  }

  // true only when both ccxt credentials are present; used to skip exchanges with no API keys (e.g. XT on dev)
  get isConfigured(): boolean {
    return !!this.config?.apiKey && !!this.config?.secret;
  }

  async getRawBalances(): Promise<Balances> {
    return this.callApi((e) => e.fetchBalance());
  }

  async getBalances(): Promise<{ total: Dictionary<number>; available: Dictionary<number> }> {
    const balances = await this.getRawBalances();

    return {
      total: this.aggregateBalances(balances.total),
      available: this.aggregateBalances(balances.free),
    };
  }

  private aggregateBalances(balances: Balance): Dictionary<number> {
    const result: Dictionary<number> = {};
    for (const [asset, amount] of Object.entries(balances)) {
      const [base, suffix] = asset.split('.');
      if (!suffix || suffix === 'F') result[base] = (result[base] ?? 0) + (amount as number);
    }
    return result;
  }

  async getAvailableBalance(currency: string): Promise<number> {
    return this.getRawBalances().then((b) => b.free[currency] ?? 0);
  }

  async getPrice(from: string, to: string): Promise<Price> {
    const orderPrice = await Util.retry(() => this.fetchLastOrderPrice(from, to), 3);

    const { direction } = await this.getTradePair(from, to);

    return Price.create(from, to, direction === OrderSide.BUY ? orderPrice : 1 / orderPrice);
  }

  async getCurrentPrice(from: string, to: string): Promise<number> {
    const { pair, direction } = await this.getTradePair(from, to);
    const price = await this.fetchCurrentOrderPrice(pair, direction);
    return direction === OrderSide.BUY ? price : 1 / price;
  }

  async getTrades(from?: string, to?: string, since?: Date): Promise<Trade[]> {
    const pair = from && to && (await this.getPair(from, to));
    return this.callApi((e) => e.fetchMyTrades(pair, this.toCcxtDate(since)));
  }

  async getOpenTrades(from: string, to: string): Promise<Order[]> {
    const pair = await this.getPair(from, to);
    return this.callApi((e) => e.fetchOpenOrders(pair));
  }

  async buy(from: string, to: string, amount: number): Promise<string> {
    const price = await this.getCurrentPrice(from, to);

    const tradeAmount = amount * price;

    return this.trade(from, to, tradeAmount);
  }

  async sell(from: string, to: string, amount: number): Promise<string> {
    return this.trade(from, to, amount);
  }

  async getTrade(id: string, from: string, to: string): Promise<Order> {
    const pair = await this.getPair(from, to);

    return this.callApi((e) => e.fetchOrder(id, pair));
  }

  async checkTrade(id: string, from: string, to: string): Promise<boolean> {
    const order = await this.getTrade(id, from, to);

    switch (order.status) {
      case OrderStatus.OPEN: {
        const price = await this.fetchCurrentOrderPrice(order.symbol, order.side);

        // price changed -> update price
        if (price !== order.price) {
          // adapt amount to price change (for buy orders)
          let remainingAmount = order.remaining;
          if (order.side === OrderSide.BUY) {
            const { amount: amountPrecision } = await this.getPrecision(order.symbol);

            remainingAmount = Util.floorToValue((order.remaining * order.price) / price, amountPrecision);
          }
          this.logger.verbose(
            `Order ${order.id} open, price changed ${order.price} -> ${price}, restarting with ${remainingAmount}`,
          );

          try {
            const id = await this.updateOrderPrice(order, remainingAmount, price);

            if (id) {
              this.logger.verbose(`Order ${order.id} changed to ${id}`);
              throw new TradeChangedException(id);
            }
          } catch (e) {
            if (e instanceof TradeChangedException) throw e;

            const updatedOrder = await this.getTrade(order.id, from, to);
            if (updatedOrder.status === OrderStatus.CLOSED) return true;

            this.logger.verbose(`Could not update order ${order.id} price: ${JSON.stringify(updatedOrder)}`);

            if (updatedOrder.status === OrderStatus.OPEN)
              await this.cancelOrder(order.id, order.symbol).catch((e) =>
                this.logger.error(`Error while cancelling order ${order.id}:`, e),
              );
          }
        } else {
          this.logger.verbose(`Order ${order.id} open, price is still ${price}`);
        }

        return false;
      }

      case OrderStatus.CANCELED: {
        // check for min. amount
        const { amount: minAmount, cost: minCost } = await this.getMinTradeAmount(order.symbol);
        if (order.remaining < minAmount || order.remaining * order.price < minCost) {
          return true;
        }

        this.logger.verbose(`Order ${order.id} cancelled, restarting with ${order.remaining}`);

        const id = await this.placeOrder(order.symbol, order.side as OrderSide, order.remaining);

        this.logger.verbose(`Order ${order.id} changed to ${id}`);

        throw new TradeChangedException(id);
      }

      case OrderStatus.CLOSED:
        this.logger.verbose(`Order ${order.id} closed`);
        return true;

      default:
        return false;
    }
  }

  /**
   * A venue whose ccxt implementation needs other withdrawal parameters overrides {@link executeWithdrawal}, not
   * this method: the cache handling below is what keeps a stale maximum from capping every retry of the next
   * hour to the amount the venue has just rejected, and an override placed here would silently drop it.
   */
  async withdrawFunds(
    token: string,
    amount: number,
    address: string,
    key: string,
    network?: string,
  ): Promise<WithdrawalResponse> {
    return this.executeWithdrawal(token, amount, address, key, network).catch((e) => {
      // a rejection for exceeding the maximum proves the cached limits stale, and the rejection carries the new
      // number: kept, the cache would cap every retry of the next hour to the very amount just rejected
      if (this.isWithdrawalAboveMaximumError(e)) {
        this.logger.warn(`Withdrawal of ${token} at ${this.name} was above the venue maximum, reloading limits:`, e);
        this.currenciesCache.invalidate();
      }

      throw e;
    });
  }

  /** The venue call itself, and the only part of a withdrawal a venue may replace. */
  protected async executeWithdrawal(
    token: string,
    amount: number,
    address: string,
    key: string,
    network?: string,
  ): Promise<WithdrawalResponse> {
    return this.callApi((e) => e.withdraw(token, amount, address, undefined, { key, network }));
  }

  async getWithdraw(id: string, token: string): Promise<Transaction | undefined> {
    const withdrawals = await this.callApi((e) => e.fetchWithdrawals(token, undefined, 50, { limit: 50 }));
    return withdrawals.find((w) => w.id === id);
  }

  async getDeposits(token: string, since?: Date, _chain?: string): Promise<Transaction[]> {
    return this.callApi((e) => e.fetchDeposits(token, this.toCcxtDate(since), 200, { limit: 200 }));
  }

  async getWithdrawals(token: string, since?: Date): Promise<Transaction[]> {
    return this.callApi((e) => e.fetchWithdrawals(token, this.toCcxtDate(since), 200, { limit: 200 }));
  }

  async getWithdrawalFee(token: string, network?: string): Promise<number> {
    const fees = await this.callApi((e) => e.fetchDepositWithdrawFees([token]));
    const tokenFees = fees[token];

    return (tokenFees?.networks?.[network] as any)?.withdraw?.fee ?? tokenFees?.withdraw?.fee ?? 0;
  }

  /**
   * Per-withdrawal limits the venue publishes for a token on a network. Read from `fetchCurrencies`, because
   * `fetchDepositWithdrawFees` (the source of {@link getWithdrawalFee}) carries fees only, no limits.
   *
   * Every unknown case yields an empty result, which callers must read as "no limit known" and never as zero:
   * capping a withdrawal to zero would turn a working payout into an endless loop of empty deliveries. Each of
   * those cases is logged, because the empty result cannot tell "the venue publishes no maximum" from "the
   * maximum could not be read" — only the second one needs a human, and only the log can name it.
   */
  async getWithdrawalLimits(token: string, network?: string): Promise<WithdrawalLimits> {
    // without a network there is nothing to look up: ccxt aggregates the token-level `limits.withdraw` as the
    // maximum over all networks, which is above what any single network accepts and would cap nothing
    if (!network) return {};

    const currencies = await this.getCurrencies();
    // a failed lookup is already logged by getCurrencies, an empty answer is not: ccxt returns an empty
    // dictionary, and no error, when the venue serves its currency list to authenticated callers only and no
    // credentials are configured — that lookup would otherwise leave no trace at all
    if (!currencies) return {};

    if (!Object.keys(currencies).length) {
      this.logger.warn(`No withdrawal limits for ${token} at ${this.name}: the venue published no currencies`);
      return {};
    }

    const currency = currencies[token];
    if (!currency) {
      this.logger.warn(`No withdrawal limits for ${token} at ${this.name}: the venue publishes no such token`);
      return {};
    }

    const networks: Dictionary<CurrencyNetwork> = currency.networks ?? {};

    const matches = this.findNetworks(networks, network);
    if (matches.length !== 1) {
      // name the identifiers the venue published and the lookup ran on, not the dictionary keys: ccxt replaces
      // the key with its own unified code wherever it has a mapping, so the key of "Ethereum(ERC20)" is "ERC20"
      // and a reader of the key list cannot see what was compared
      const published = Object.entries(networks).map(([key, entry]) => entry?.id ?? key);
      const verdict = matches.length ? `matches ${matches.length} of` : 'matches none of';

      this.logger.warn(
        `No withdrawal limits for ${token} at ${this.name}: network ${network} ${verdict} the networks the venue publishes for it [${published}]`,
      );
      return {};
    }

    const [entry] = matches;

    const limits = { min: this.toLimit(entry.limits?.withdraw?.min), max: this.toLimit(entry.limits?.withdraw?.max) };
    if (limits.max == null)
      this.logger.verbose(`${this.name} publishes no withdrawal maximum for ${token} on network ${network}`);

    return limits;
  }

  // --- Helper Methods --- //
  // withdrawal limits
  private async getCurrencies(): Promise<Currencies | undefined> {
    return (
      this.currenciesCache
        .get(
          `currencies-${this.name}`,
          () =>
            // the warning belongs inside the update call: AsyncCache swallows a failed update as soon as an entry
            // for the key exists, so a caller-side catch never sees this failure and would never report it. Every
            // request from here on goes out uncapped, which is worth a line
            this.callApi((e) => e.fetchCurrencies()).catch((e) => {
              this.logger.warn(`Failed to fetch currencies of ${this.name}:`, e);
              throw e;
            }),
          undefined,
          // serve the last known limits when the query fails: degrading to "no limit" sends the uncapped amount
          // the venue rejects
          true,
        )
        // the limits are advisory — a failed lookup must never fail a withdrawal that is otherwise fine
        .catch(() => undefined)
    );
  }

  /**
   * Every venue network entry spelled with the network string this repo stores. `networks` is keyed by ccxt's
   * unified network code, but only where ccxt has a mapping for the venue, and those mappings never cover every
   * network a venue lists. For an unmapped one the key, the `id` and the raw payload all carry the venue's own
   * string, which is sometimes the short code ("XMR") and sometimes a long form embedding it ("Monero(XMR)").
   *
   * This compares spellings and does nothing beyond that: it does not establish that a matched entry *is* the
   * requested network. A venue naming an unrelated network with the same delimited code would be
   * indistinguishable from the right one here, which is why the caller reads anything but a single match as no
   * limit at all, and why the code has to sit at a delimiter rather than anywhere inside the identifier.
   */
  private findNetworks(networks: Dictionary<CurrencyNetwork>, network: string): CurrencyNetwork[] {
    const candidates = Object.entries(networks).map(([key, entry]) => ({
      entry,
      // every spelling ccxt keeps of the venue's identifier: dictionary key, unified code, id and the raw fields
      ids: [key, entry?.id, entry?.network, entry?.info?.netWork, entry?.info?.network]
        .filter((i): i is string => typeof i === 'string')
        .map((i) => i.toLowerCase()),
    }));

    const wanted = network.toLowerCase();

    // an entry spelling the code and nothing else outranks one that merely embeds it
    const exact = candidates.filter((c) => c.ids.includes(wanted));
    if (exact.length) return exact.map((c) => c.entry);

    return candidates.filter((c) => c.ids.some((i) => this.embedsCode(i, wanted))).map((c) => c.entry);
  }

  /**
   * Whether `id` carries `code` as a delimited token — bounded by the ends of the identifier or by a separator
   * such as "(", ")", "-", "_" or a space, as in "Monero(XMR)" or "BEP20(BSC)".
   *
   * A plain substring test would read "ETHW" as Ethereum and "opBNB" as Optimism. Both are networks MEXC
   * publishes in their own right, next to the requested one and with a far smaller maximum of their own, so the
   * substring test does not merely miss — it caps a withdrawal to a number belonging to another network.
   */
  private embedsCode(id: string, code: string): boolean {
    const isBoundary = (char: string): boolean => !char || !/[a-z0-9]/.test(char);

    for (let i = 0; i + code.length <= id.length; i++) {
      if (!id.startsWith(code, i)) continue;
      if (isBoundary(id[i - 1]) && isBoundary(id[i + code.length])) return true;
    }

    return false;
  }

  private toLimit(value?: unknown): number | undefined {
    // ccxt builds the per-network limits with `safeString`, so they arrive as strings while the token-level
    // aggregate arrives as a number — compared as they come, "20" sorts after "100" and inverts every check
    const limit = Number(value);

    // a limit of zero is the venue's way of saying "not published", not "nothing may be withdrawn"
    return Number.isFinite(limit) && limit > 0 ? limit : undefined;
  }

  // each venue words this rejection itself, e.g. MEXC code 10255 "Withdrawal shall not be greater than the Max
  // amount of:<amount>"
  private isWithdrawalAboveMaximumError(e: Error): boolean {
    return ['greater than the max amount', 'exceeds the maximum', 'above the maximum'].some((m) =>
      e.message?.toLowerCase().includes(m),
    );
  }

  // currency pairs
  private async getMarkets(): Promise<Market[]> {
    if (!this.markets) {
      this.markets = await this.fetchMarkets();
    }

    return this.markets;
  }

  protected async fetchMarkets(): Promise<Market[]> {
    return this.callApi((e) => e.fetchMarkets());
  }

  async getMinTradeAmount(pair: string): Promise<{ amount: number; cost: number }> {
    const market = await this.getMarket(pair);
    return {
      amount: market.limits.amount.min ?? 0,
      cost: market.limits.cost?.min ?? 0,
    };
  }

  private async getPrecision(pair: string): Promise<{ price: number; amount: number }> {
    return this.getMarket(pair).then((m) => {
      return {
        price: this.convertPrecision(m.precision.price),
        amount: this.convertPrecision(m.precision.amount),
      };
    });
  }

  private convertPrecision(precision: number): number {
    return this.exchange.precisionMode === PrecisionMode.TICK_SIZE
      ? precision
      : new BigNumber(10).exponentiatedBy(-precision).toNumber();
  }

  private async getMarket(pair: string): Promise<Market> {
    return this.getMarkets().then((m) => m.find((m) => m.symbol === pair));
  }

  async getPair(from: string, to: string): Promise<string> {
    return this.getTradePair(from, to).then((p) => p.pair);
  }

  async getTradePair(from: string, to: string): Promise<{ pair: string; direction: OrderSide }> {
    // sort by active pairs first
    const currencyPairs = await this.getMarkets().then((m) =>
      m.sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1)).map((m) => m.symbol),
    );

    const selectedPair = currencyPairs.find((p) => p === `${from}/${to}` || p === `${to}/${from}`);
    if (!selectedPair) throw new BadRequestException(`${this.name}: pair with ${from} and ${to} not supported`);

    const selectedDirection = selectedPair.startsWith(to) ? OrderSide.BUY : OrderSide.SELL;

    return { pair: selectedPair, direction: selectedDirection };
  }

  private async fetchLastOrderPrice(from: string, to: string): Promise<number> {
    const pair = await this.getPair(from, to);

    const trades = await this.fetchTrades(pair, 1);
    if (trades.length === 0) throw new Error(`${this.name}: no trades found for ${pair}`);

    return Util.sort(trades, 'timestamp', 'DESC')[0].price;
  }

  protected async fetchTrades(pair: string, limit: number): Promise<Trade[]> {
    return this.callApi((e) => e.fetchTrades(pair, undefined, limit));
  }

  protected async fetchOrderBook(pair: string): Promise<OrderBook> {
    return this.callApi((e) => e.fetchOrderBook(pair));
  }

  private async fetchCurrentOrderPrice(pair: string, direction: string, orderBook?: OrderBook): Promise<number> {
    orderBook ??= await this.fetchOrderBook(pair);

    const { price: pricePrecision } = await this.getPrecision(pair);

    const priceOffset = 0; // positive for better price
    const price = direction === OrderSide.BUY ? orderBook.asks[0][0] - priceOffset : orderBook.bids[0][0] + priceOffset;

    return Util.roundToValue(price, pricePrecision);
  }

  async getBestBidLiquidity(from: string, to: string): Promise<{ price: number; amount: number } | undefined> {
    const { pair, direction } = await this.getTradePair(from, to);

    const { amount: minAmount, cost: minCost } = await this.getMinTradeAmount(pair);
    const orderBook = await this.fetchOrderBook(pair);
    const { price: pricePrecision } = await this.getPrecision(pair);

    const orders = direction === OrderSide.SELL ? orderBook.bids : orderBook.asks;

    // Find first order that meets minimum amount requirement
    const validOrder = orders.find(([price, amount]) => amount >= minAmount && price * amount >= minCost);
    if (!validOrder) return undefined;

    const [price, amount] = validOrder;

    return {
      price: Util.roundToValue(price, pricePrecision),
      amount,
    };
  }

  // orders

  protected async trade(from: string, to: string, amount: number): Promise<string> {
    // place the order
    const { pair, direction } = await this.getTradePair(from, to);
    const { amount: amountPrecision } = await this.getPrecision(pair);
    const orderBook = await this.fetchOrderBook(pair);
    const price = await this.fetchCurrentOrderPrice(pair, direction, orderBook);

    const orders = direction === OrderSide.BUY ? orderBook.asks : orderBook.bids;

    let orderAmount = Util.floorToValue(direction === OrderSide.BUY ? amount / price : amount, amountPrecision);

    // Snap to nearby order book amount to avoid leaving dust
    const matchingOrder = orders.find(([, amt]) => Math.abs(amt - orderAmount) <= 2 * amountPrecision);
    if (matchingOrder) {
      orderAmount = matchingOrder[1];
    }

    const id = await this.placeOrder(pair, direction, orderAmount, price);

    this.logger.verbose(
      `Order ${id} placed (pair: ${pair}, direction: ${direction}, amount: ${orderAmount}, price: ${price})`,
    );

    return id;
  }

  private async placeOrder(pair: string, direction: OrderSide, amount: number, price?: number): Promise<string> {
    price ??= await this.fetchCurrentOrderPrice(pair, direction);

    return this.createOrder(pair, direction, amount, price).then((o) => o.id);
  }

  protected async createOrder(pair: string, direction: OrderSide, amount: number, price: number): Promise<Order> {
    return this.callApi((e) => e.createOrder(pair, 'limit', direction, amount, price));
  }

  protected async updateOrderPrice(order: Order, amount: number, price: number): Promise<string> {
    return this.callApi((e) => e.editOrder(order.id, order.symbol, order.type, order.side, amount, price)).then(
      (o) => o.id,
    );
  }

  protected async cancelOrder(orderId: string, symbol: string): Promise<void> {
    await this.callApi((e) => e.cancelOrder(orderId, symbol));
  }

  // other
  protected async callApi<T>(action: (exchange: Exchange) => Promise<T>): Promise<T> {
    return this.queue.handle(() =>
      action(this.exchange).catch((e) => {
        if (e.message?.includes('throttle')) {
          this.logger.verbose(`${this.name} throttler: ${JSON.stringify(this.exchange.throttler)}`);
        }

        throw e;
      }),
    );
  }

  mapNetwork(blockchain: Blockchain): string | false {
    return this.networks[blockchain];
  }

  protected toCcxtDate(date?: Date): number | undefined {
    // ignore milliseconds
    return date ? Util.round(date?.getTime(), -3) : undefined;
  }
}
