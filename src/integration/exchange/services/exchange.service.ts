import { BadRequestException } from '@nestjs/common';
import { Exchange, Market, Order, Trade, Transaction, WithdrawalResponse } from 'ccxt';
import { Price } from '../../../subdomains/supporting/pricing/domain/entities/price';
import { Util } from 'src/shared/utils/util';
import { PricingProvider } from 'src/subdomains/supporting/pricing/domain/interfaces';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { TradeChangedException } from '../exceptions/trade-changed.exception';
import { DfxLogger } from 'src/shared/services/dfx-logger';

export enum OrderSide {
  BUY = 'buy',
  SELL = 'sell',
}

enum OrderStatus {
  OPEN = 'open',
  CLOSED = 'closed',
  CANCELED = 'canceled',
}

export class ExchangeService implements PricingProvider {
  private markets: Market[];
  private readonly logger = new DfxLogger(ExchangeService);

  constructor(private readonly exchange: Exchange, private readonly queue?: QueueHandler) {
    this.queue ??= new QueueHandler(180000, 60000);
  }

  get name(): string {
    return this.exchange.name;
  }

  async getBalances() {
    return this.callApi((e) => e.fetchBalance());
  }

  async getBalance(currency: string): Promise<number> {
    return this.getBalances().then((b) => b.total[currency]);
  }

  async getPrice(from: string, to: string): Promise<Price> {
    const orderPrice = await Util.retry(() => this.fetchLastOrderPrice(from, to), 3);

    const { direction } = await this.getTradePair(from, to);

    return Price.create(from, to, direction === OrderSide.BUY ? orderPrice : 1 / orderPrice);
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

  async checkTrade(id: string, from: string, to: string): Promise<boolean> {
    const pair = await this.getPair(from, to);

    // loop in case we have to cancel the order
    for (let i = 0; i < 5; i++) {
      const order = await this.callApi((e) => e.fetchOrder(id, pair));

      switch (order.status) {
        case OrderStatus.OPEN:
          const price = await this.fetchCurrentOrderPrice(order.symbol, order.side);
          if (price === order.price) return false;

          // price changed -> abort and re-fetch
          await this.cancelOrder(order).catch(() => undefined);
          break;

        case OrderStatus.CANCELED:
          // check for min. amount
          const minAmount = await this.getMinTradeAmount(order.symbol);
          if (order.remaining < minAmount) {
            return true;
          }

          const id = await this.placeOrder(order.symbol, order.side as OrderSide, order.remaining);
          throw new TradeChangedException(id);

        case OrderStatus.CLOSED:
          return true;

        default:
          return false;
      }
    }

    throw new Error(`${this.name}: failed to cancel order ${id}`);
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
    const withdrawals = await this.callApi((e) => e.fetchWithdrawals(token, undefined, 50));
    return withdrawals.find((w) => w.id === id);
  }

  async getDeposits(token: string, since?: Date): Promise<Transaction[]> {
    return this.callApi((e) => e.fetchDeposits(token, since?.getTime(), 50));
  }

  async getWithdrawals(token: string, since?: Date): Promise<Transaction[]> {
    return this.callApi((e) => e.fetchWithdrawals(token, since?.getTime(), 50));
  }

  // --- Helper Methods --- //
  // currency pairs
  private async getMarkets(): Promise<Market[]> {
    if (!this.markets) {
      this.markets = await this.callApi((e) => e.fetchMarkets());
    }

    return this.markets;
  }

  private async getMinTradeAmount(pair: string): Promise<number> {
    return this.getMarkets().then((m) => m.find((m) => m.symbol === pair).limits.amount.min);
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

    return trades.sort((a, b) => b.timestamp - a.timestamp)[0].price;
  }

  private async getCurrentPrice(from: string, to: string): Promise<number> {
    const { pair, direction } = await this.getTradePair(from, to);
    const price = await this.fetchCurrentOrderPrice(pair, direction);
    return direction === OrderSide.BUY ? price : 1 / price;
  }

  private async fetchCurrentOrderPrice(pair: string, direction: string): Promise<number> {
    /* 
        If 'buy' we want to buy token1 using token2. Example BTC/EUR on 'buy' means we buy BTC using EUR
            > We want to have the highest 'bids' price in the orderbook
        If 'sell' we want to sell token1 using token2. Example BTC/EUR on 'sell' means we sell BTC using EUR
            > We want to have the lowest 'asks' price in the orderbook
    */
    const orderBook = await this.callApi((e) => e.fetchOrderBook(pair));
    return direction == OrderSide.BUY ? orderBook.bids[0][0] : orderBook.asks[0][0];
  }

  // orders

  private async trade(from: string, to: string, amount: number): Promise<string> {
    // check balance
    const balance = await this.getBalance(from);
    if (amount > balance) {
      throw new BadRequestException(
        `${this.name}: there is not enough balance on for token ${from}. Current balance: ${balance} requested balance: ${amount}`,
      );
    }

    // place the order
    const { pair, direction } = await this.getTradePair(from, to);
    const price = await this.fetchCurrentOrderPrice(pair, direction);
    const orderAmount = Util.round(direction === OrderSide.BUY ? amount / price : amount, 6);

    return this.placeOrder(pair, direction, orderAmount, price);
  }

  private async placeOrder(pair: string, direction: OrderSide, amount: number, price?: number): Promise<string> {
    price ??= await this.fetchCurrentOrderPrice(pair, direction);

    const order = await this.createOrder(pair, direction, amount, price);

    return order.id;
  }

  protected async createOrder(pair: string, direction: OrderSide, amount: number, price: number): Promise<Order> {
    return this.callApi((e) => e.createOrder(pair, 'limit', direction, amount, price));
  }

  private async cancelOrder(order: Order): Promise<void> {
    await this.callApi((e) => e.cancelOrder(order.id, order.symbol));
  }

  // other
  protected async callApi<T>(action: (exchange: Exchange) => Promise<T>): Promise<T> {
    return this.queue.handle(() => action(this.exchange));
  }
}
