import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Exchange, ExchangeError, Market, Order, Trade, Transaction, WithdrawalResponse } from 'ccxt';
import { TradeResponse, PartialTradeResponse } from '../dto/trade-response.dto';
import { Price } from '../dto/price.dto';
import { Util } from 'src/shared/utils/util';
import { PriceProvider } from 'src/subdomains/supporting/pricing/interfaces';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export enum OrderSide {
  BUY = 'buy',
  SELL = 'sell',
}

enum OrderStatus {
  OPEN = 'open',
  CLOSED = 'closed',
  CANCELED = 'canceled',
}

export type ExchangeExtended = Exchange & { depositAddresses: { [key in Blockchain]?: string } } & {
  depositAddressesKeys: { [key in Blockchain]?: string };
};

export class ExchangeService implements PriceProvider {
  private markets: Market[];

  private readonly queue: QueueHandler;

  constructor(private readonly exchange: Exchange, readonly scheduler: SchedulerRegistry) {
    this.queue = new QueueHandler(scheduler, 60000);
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

    return {
      source: from,
      target: to,
      price: direction === OrderSide.BUY ? orderPrice : 1 / orderPrice,
    };
  }

  async getTrades(from?: string, to?: string): Promise<Trade[]> {
    const pair = from && to && (await this.getPair(from, to));
    return this.callApi((e) => e.fetchMyTrades(pair));
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

  async getWithdraw(id: string, token: string): Promise<Transaction> {
    const withdrawals = await this.callApi((e) => e.fetchWithdrawals(token, undefined, 50));
    const withdrawal = withdrawals.find((w) => w.id === id);
    if (!withdrawal) throw new NotFoundException('Withdrawal not found');

    return withdrawal;
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
    orderType: string,
    maxRetries = 100,
  ): Promise<TradeResponse> {
    const orders: { [id: string]: PartialTradeResponse } = {};
    let order: Order;
    let numRetries = 0;
    let remainingAmount = amount;

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

      console.log(
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

    // cancel existing order
    if (order?.status === OrderStatus.OPEN) {
      await this.cancelOrder(order);
    }

    const orderList = Object.values(orders);
    const avg = this.getWeightedAveragePrice(orderList);
    return {
      orderSummary: {
        currencyPair: order.symbol,
        price: avg.price,
        amount: avg.amountSum,
        orderSide: order.side,
        fees: avg.feeSum,
      },
      orderList: orderList,
    };
  }

  private async createOrUpdateOrder(
    from: string,
    to: string,
    orderType: string,
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
      console.log(`${this.name}: amount (${amount} ${from}) is too small to create a ${direction} order for ${pair}`);
      return undefined;
    }

    console.log(
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
    return this.queue
      .handle(() => action(this.exchange))
      .catch((e: ExchangeError) => {
        throw new ServiceUnavailableException(e.message);
      });
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
