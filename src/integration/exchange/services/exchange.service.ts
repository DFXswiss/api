import { BadRequestException, Inject, OnModuleInit } from '@nestjs/common';
import BigNumber from 'bignumber.js';
import {
  Balances,
  Dictionary,
  Exchange,
  ExchangeError,
  Market,
  Order,
  Trade,
  Transaction,
  WithdrawalResponse,
} from 'ccxt';
import { ExchangeConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
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

  protected abstract readonly networks: { [b in Blockchain]: string };
  protected readonly exchange: Exchange;

  private markets: Market[];

  @Inject() private readonly registry: ExchangeRegistryService;

  constructor(
    exchange: { new (config: ExchangeConfig): Exchange },
    public readonly config: ExchangeConfig,
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

  async getBalances(): Promise<Balances> {
    return this.callApi((e) => e.fetchBalance());
  }

  async getTotalBalances(): Promise<Dictionary<number>> {
    const balances = await this.getBalances().then((b) => b.total);

    const totalBalances = {};
    for (const [asset, amount] of Object.entries(balances)) {
      const [base, suffix] = asset.split('.');
      if (!suffix || suffix === 'F') totalBalances[base] = (totalBalances[base] ?? 0) + amount;
    }

    return totalBalances;
  }

  async getAvailableBalance(currency: string): Promise<number> {
    return this.getBalances().then((b) => b.total[currency]);
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
    return this.callApi((e) => e.fetchMyTrades(pair, since?.getTime()));
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
      case OrderStatus.OPEN:
        const price = await this.fetchCurrentOrderPrice(order.symbol, order.side);

        // price changed -> update price
        if (price !== order.price) {
          this.logger.verbose(
            `Order ${order.id} open, price changed ${order.price} -> ${price}, restarting with ${order.remaining}`,
          );
          const id = await this.updateOrderPrice(order, price).catch(async (e: ExchangeError) => {
            await this.callApi((e) => e.cancelOrder(order.id, order.symbol));

            throw e;
          });

          if (id) {
            this.logger.verbose(`Order ${order.id} changed to ${id}`);
            throw new TradeChangedException(id);
          }
        } else {
          this.logger.verbose(`Order ${order.id} open, price is still ${price}`);
        }

        return false;

      case OrderStatus.CANCELED:
        // check for min. amount
        const minAmount = await this.getMinTradeAmount(order.symbol);
        if (order.remaining < minAmount) {
          return true;
        }

        this.logger.verbose(`Order ${order.id} cancelled, restarting with ${order.remaining}`);

        const id = await this.placeOrder(order.symbol, order.side as OrderSide, order.remaining);

        this.logger.verbose(`Order ${order.id} changed to ${id}`);

        throw new TradeChangedException(id);

      case OrderStatus.CLOSED:
        this.logger.verbose(`Order ${order.id} closed`);
        return true;

      default:
        return false;
    }
  }

  async withdrawFunds(
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

  async getDeposits(token: string, since?: Date): Promise<Transaction[]> {
    return this.callApi((e) => e.fetchDeposits(token, since?.getTime(), 200, { limit: 200 }));
  }

  async getWithdrawals(token: string, since?: Date): Promise<Transaction[]> {
    return this.callApi((e) => e.fetchWithdrawals(token, since?.getTime(), 200, { limit: 200 }));
  }

  // --- Helper Methods --- //
  // currency pairs
  private async getMarkets(): Promise<Market[]> {
    if (!this.markets) {
      this.markets = await this.callApi((e) => e.fetchMarkets()).then((markets) => markets.filter((m) => m.active));
    }

    return this.markets;
  }

  private async getMinTradeAmount(pair: string): Promise<number> {
    return this.getMarket(pair).then((m) => m.limits.amount.min);
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
    const currencyPairs = await this.getMarkets().then((m) => m.map((m) => m.symbol));
    const selectedPair = currencyPairs.find((p) => p === `${from}/${to}` || p === `${to}/${from}`);
    if (!selectedPair) throw new BadRequestException(`${this.name}: pair with ${from} and ${to} not supported`);

    const selectedDirection = selectedPair.startsWith(to) ? OrderSide.BUY : OrderSide.SELL;

    return { pair: selectedPair, direction: selectedDirection };
  }

  private async fetchLastOrderPrice(from: string, to: string): Promise<number> {
    const pair = await this.getPair(from, to);

    const trades = await this.callApi((e) => e.fetchTrades(pair));
    if (trades.length === 0) throw new Error(`${this.name}: no trades found for ${pair}`);

    return Util.sort(trades, 'timestamp', 'DESC')[0].price;
  }

  private async fetchCurrentOrderPrice(pair: string, direction: string): Promise<number> {
    const orderBook = await this.callApi((e) => e.fetchOrderBook(pair));

    const { price: pricePrecision } = await this.getPrecision(pair);

    const priceOffset = 0; // positive for better price
    const price = direction === OrderSide.BUY ? orderBook.asks[0][0] - priceOffset : orderBook.bids[0][0] + priceOffset;

    return Util.roundToValue(price, pricePrecision);
  }

  // orders

  private async trade(from: string, to: string, amount: number): Promise<string> {
    // place the order
    const { pair, direction } = await this.getTradePair(from, to);
    const { amount: amountPrecision } = await this.getPrecision(pair);
    const price = await this.fetchCurrentOrderPrice(pair, direction);

    const orderAmount = Util.floorToValue(direction === OrderSide.BUY ? amount / price : amount, amountPrecision);

    const id = await this.placeOrder(pair, direction, orderAmount, price);

    this.logger.verbose(
      `Order ${id} placed (pair: ${pair}, direction: ${direction}, amount: ${amount}, price: ${price})`,
    );

    return id;
  }

  private async placeOrder(pair: string, direction: OrderSide, amount: number, price?: number): Promise<string> {
    price ??= await this.fetchCurrentOrderPrice(pair, direction);

    return this.createOrder(pair, direction, amount, price).then((o) => o.id);
  }

  private async createOrder(pair: string, direction: OrderSide, amount: number, price: number): Promise<Order> {
    return this.callApi((e) => e.createOrder(pair, 'limit', direction, amount, price));
  }

  protected async updateOrderPrice(order: Order, price: number): Promise<string> {
    return this.callApi((e) =>
      e.editOrder(order.id, order.symbol, order.type, order.side, order.remaining, price),
    ).then((o) => o.id);
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

  mapNetwork(blockchain: Blockchain): string {
    return this.networks[blockchain];
  }
}
