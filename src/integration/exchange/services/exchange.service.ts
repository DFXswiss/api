import { BadRequestException } from '@nestjs/common';
import { Exchange, Market, Order, Trade, Transaction, WithdrawalResponse } from 'ccxt';
import { TradeResponse, PartialTradeResponse } from '../dto/trade-response.dto';
import { Price } from '../../../subdomains/supporting/pricing/domain/entities/price';
import { Util } from 'src/shared/utils/util';
import { PricingProvider } from 'src/subdomains/supporting/pricing/domain/interfaces';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { OrderType } from 'ccxt/js/src/base/types';
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

  async getTrades(since?: Date, from?: string, to?: string): Promise<Trade[]> {
    const pair = from && to && (await this.getPair(from, to));
    return this.callApi((e) => e.fetchMyTrades(pair, since?.getTime()));
  }

  async getOpenTrades(from?: string, to?: string): Promise<Order[]> {
    const pair = from && to && (await this.getPair(from, to));
    return this.callApi((e) => e.fetchOpenOrders(pair));
  }

  async trade(from: string, to: string, amount: number): Promise<TradeResponse> {
    /*
      The following logic is applied

      1. place order
      2. query every 5s if order has been filled up to 60s
      3. if after 60s order is not filled then cancel order and go back to 1.)
      4. if after 60s order is partially filled then cancel order and go back to 1 with the remaining funds that were not filled
      5. return buy/sell price. If partially filled then return average price over all the orders
    */

    // check balance
    const balance = await this.getBalance(from);
    if (amount > balance) {
      throw new BadRequestException(
        `There is not enough balance for token ${from}. Current balance: ${balance} requested balance: ${amount}`,
      );
    }

    // place the order
    return this.tryToOrder(from, to, amount, 'limit');
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

  async getPair(from: string, to: string): Promise<string> {
    return this.getTradePair(from, to).then((p) => p.pair);
  }

  async getTradePair(from: string, to: string): Promise<{ pair: string; direction: OrderSide }> {
    const currencyPairs = await this.getMarkets().then((m) => m.map((m) => m.symbol));
    const selectedPair = currencyPairs.find((p) => p === `${from}/${to}` || p === `${to}/${from}`);
    if (!selectedPair) throw new BadRequestException(`Pair with ${from} and ${to} not supported`);

    const selectedDirection = selectedPair.startsWith(to) ? OrderSide.BUY : OrderSide.SELL;

    return { pair: selectedPair, direction: selectedDirection };
  }

  private async fetchLastOrderPrice(from: string, to: string): Promise<number> {
    const pair = await this.getPair(from, to);

    const trades = await this.callApi((e) => e.fetchTrades(pair));
    if (trades.length === 0) throw new Error(`No trades found for ${pair}`);

    return trades.sort((a, b) => b.timestamp - a.timestamp)[0].price;
  }

  private async fetchCurrentOrderPrice(from: string, to: string): Promise<number> {
    const { pair, direction } = await this.getTradePair(from, to);

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
  private async tryToOrder(
    from: string,
    to: string,
    amount: number,
    orderType: OrderType,
    maxRetries = 100,
  ): Promise<TradeResponse> {
    const orders: { [id: string]: PartialTradeResponse } = {};
    let order: Order;
    let numRetries = 0;
    let remainingAmount = amount;
    let error: string;

    try {
      do {
        // create a new order with the remaining amount, if order undefined or price changed
        const price = await this.fetchCurrentOrderPrice(from, to);
        if (price !== order?.price) {
          remainingAmount = amount - Util.sumObj(Object.values(orders), 'fromAmount');

          order = await this.createOrUpdateOrder(from, to, orderType, remainingAmount, price, order);
          if (!order) break;
        }

        // wait for completion
        order = await this.pollOrder(order);

        // get amounts
        const fromAmount = order.side === OrderSide.BUY ? order.filled * order.price : order.filled;
        const toAmount = order.side === OrderSide.BUY ? order.filled : order.filled * order.price;

        this.logger.info(
          `${this.name}: order ${order.id} is ${order.status} (filled: ${fromAmount}/${remainingAmount} at price ${order.price}, total: ${amount})`,
        );

        // check for partial orders
        if (order.status != OrderStatus.CANCELED && order.filled) {
          orders[order.id] = {
            id: order.id,
            price: order.price,
            fromAmount: fromAmount,
            toAmount: toAmount,
            timestamp: new Date(order.timestamp),
            fee: order.fee,
          };
        }

        numRetries++;
      } while (order?.status !== OrderStatus.CLOSED && numRetries < maxRetries);
    } catch (e) {
      this.logger.error(`${this.name}: error during trade (${amount} ${from} -> ${to}):`, e);
      error = e.message;

      if (!order) throw e;
    }

    // cancel existing order
    if (order?.status === OrderStatus.OPEN) {
      await this.cancelOrder(order).catch(() => undefined);
    }

    const orderList = Object.values(orders);
    const avg = this.getWeightedAveragePrice(orderList);
    return {
      orderSummary: {
        currencyPair: order?.symbol,
        orderSide: order?.side,
        price: avg.price,
        amount: avg.amountSum,
        fees: avg.feeSum,
      },
      orderList: orderList,
      error: error,
    };
  }

  private async createOrUpdateOrder(
    from: string,
    to: string,
    orderType: OrderType,
    amount: number,
    price: number,
    order?: Order,
  ): Promise<Order | undefined> {
    // cancel existing order
    if (order?.status === OrderStatus.OPEN) {
      await this.cancelOrder(order);
    }

    const { pair, direction } = await this.getTradePair(from, to);
    const orderAmount = direction === OrderSide.BUY ? amount / price : amount;

    // check for min amount
    const minAmount = await this.getMarkets().then((m) => m.find((m) => m.symbol === pair).limits.amount.min);
    if (orderAmount < minAmount) {
      this.logger.warn(
        `${this.name}: amount (${amount} ${from}) is too small to create a ${direction} order for ${pair}`,
      );
      return undefined;
    }

    this.logger.info(
      `${this.name}: creating new ${direction} order on ${pair} (${amount} ${from} for price ${price}, order amount ${orderAmount})`,
    );
    return this.callApi((e) =>
      e.createOrder(pair, orderType, direction, orderAmount, price, {
        oflags: 'post',
      }),
    );
  }

  private async pollOrder(order: Order): Promise<Order> {
    return Util.poll<Order>(
      () => this.callApi((e) => e.fetchOrder(order.id, order.symbol)),
      (o) => [OrderStatus.CLOSED, OrderStatus.CANCELED].includes(o?.status as OrderStatus),
      5000,
      120000,
      true,
    );
  }

  private async cancelOrder(order: Order): Promise<void> {
    await this.callApi((e) => e.cancelOrder(order.id, order.symbol));
  }

  // other
  private async callApi<T>(action: (exchange: Exchange) => Promise<T>): Promise<T> {
    return this.queue.handle(() => action(this.exchange));
  }

  getWeightedAveragePrice(list: PartialTradeResponse[]): { price: number; amountSum: number; feeSum: number } {
    const priceSum = list.reduce((a, b) => a + b.price * b.toAmount, 0);
    const amountSum = Util.round(
      list.reduce((a, b) => a + b.toAmount, 0),
      8,
    );
    const price = Util.round(priceSum / amountSum, 8);
    const feeSum = Util.round(
      list.reduce((a, b) => a + b.fee.cost, 0),
      8,
    );

    return { price, amountSum, feeSum };
  }
}
