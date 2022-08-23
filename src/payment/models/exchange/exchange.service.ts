import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Exchange, ExchangeError, Market, Order, Transaction, WithdrawalResponse } from 'ccxt';
import { TradeResponse, PartialTradeResponse } from './dto/trade-response.dto';
import { Price } from './dto/price.dto';
import { Util } from 'src/shared/util';

export enum OrderSide {
  BUY = 'buy',
  SELL = 'sell',
}

enum OrderStatus {
  OPEN = 'open',
  CLOSED = 'closed',
  CANCELED = 'canceled',
}

export class ExchangeService {
  private markets: Market[];

  constructor(private readonly exchange: Exchange) {}

  get name(): string {
    return this.exchange.name;
  }

  async getBalances() {
    return this.callApi((e) => e.fetchBalance());
  }

  async getBalance(currency: string): Promise<number> {
    return this.getBalances().then((b) => b.total[currency]);
  }

  async getPrice(fromCurrency: string, toCurrency: string): Promise<Price> {
    const { pair, direction } = await this.getCurrencyPair(fromCurrency, toCurrency);
    const price = await Util.retry(() => this.fetchOrderPrice(pair, direction), 3);
    const [left, right] = pair.split('/');

    return direction === OrderSide.BUY
      ? {
          source: right,
          target: left,
          price: price,
        }
      : {
          source: left,
          target: right,
          price: 1 / price,
        };
  }

  async trade(fromCurrency: string, toCurrency: string, amount: number): Promise<TradeResponse> {
    /*
      The following logic is applied

      1. place order
      2. query every 5s if order has been filled up to 60s
      3. if after 60s order is not filled then cancel order and go back to 1.)
      4. if after 60s order is partially filled then cancel order and go back to 1 with the remaining funds that were not filled
      5. return buy/sell price. If partially filled then return average price over all the orders
    */

    // check balance
    const balance = await this.getBalance(fromCurrency);
    if (amount > balance) {
      throw new BadRequestException(
        `There is not enough balance for token ${fromCurrency}. Current balance: ${balance} requested balance: ${amount}`,
      );
    }

    // place the order
    const { pair, direction } = await this.getCurrencyPair(fromCurrency, toCurrency);
    return this.tryToOrder(pair, 'limit', direction, amount);
  }

  async withdrawFunds(token: string, amount: number, address: string, key: string, network?: string): Promise<WithdrawalResponse> {
    return await this.callApi((e) => e.withdraw(token, amount, address, undefined, { key, network }));
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

  async getCurrencyPair(fromCurrency: string, toCurrency: string): Promise<{ pair: string; direction: OrderSide }> {
    const currencyPairs = await this.getMarkets().then((m) => m.map((m) => m.symbol));
    const selectedPair = currencyPairs.find(
      (p) => p === `${fromCurrency}/${toCurrency}` || p === `${toCurrency}/${fromCurrency}`,
    );
    if (!selectedPair) throw new BadRequestException(`Pair with ${fromCurrency} and ${toCurrency} not supported`);

    const selectedDirection = selectedPair.startsWith(toCurrency) ? OrderSide.BUY : OrderSide.SELL;

    return { pair: selectedPair, direction: selectedDirection };
  }

  private async fetchOrderPrice(currencyPair: string, orderSide: OrderSide): Promise<number> {
    /* 
        If 'buy' we want to buy token1 using token2. Example BTC/EUR on 'buy' means we buy BTC using EUR
            > We want to have the highest 'bids' price in the orderbook
        If 'sell' we want to sell token1 using token2. Example BTC/EUR on 'sell' means we sell BTC using EUR
            > We want to have the lowest 'asks' price in the orderbook
    */
    const orderBook = await this.callApi((e) => e.fetchOrderBook(currencyPair));
    return orderSide == OrderSide.BUY ? orderBook.bids[0][0] : orderBook.asks[0][0];
  }

  // orders
  private async tryToOrder(
    currencyPair: string,
    orderType: string,
    orderSide: OrderSide,
    amount: number,
    maxRetries = 100,
  ): Promise<TradeResponse> {
    const orderList: PartialTradeResponse[] = [];
    let order: Order;
    let numRetries = 0;

    do {
      // (re)create order
      order = await this.createOrder(currencyPair, orderType, orderSide, amount, order);
      if (!order) break;

      // wait for completion
      order = await Util.poll<Order>(
        () => this.callApi((e) => e.fetchOrder(order.id, currencyPair)),
        (o) => [OrderStatus.CLOSED, OrderStatus.CANCELED].includes(o?.status as OrderStatus),
        5000,
        120000,
        true,
      );

      // check for partial orders
      if (order?.status != OrderStatus.CANCELED && order?.filled) {
        orderList.push({
          id: order.id,
          price: order.price,
          amount: orderSide == OrderSide.BUY ? order.filled : order.filled * order.price,
          timestamp: new Date(order.timestamp),
          fee: order.fee,
        });
        amount -= orderSide == OrderSide.BUY ? order.filled * order.price : order.filled;
      }

      numRetries++;
    } while (order?.status !== OrderStatus.CLOSED && numRetries < maxRetries);

    // cancel existing order
    if (order?.status === OrderStatus.OPEN) {
      await this.callApi((e) => e.cancelOrder(order.id, currencyPair));
    }

    const avg = this.getWeightedAveragePrice(orderList);
    return {
      orderSummary: {
        currencyPair: currencyPair,
        price: avg.price,
        amount: avg.amountSum,
        orderSide: orderSide,
        fees: avg.feeSum,
      },
      orderList: orderList,
    };
  }

  private async createOrder(
    currencyPair: string,
    orderType: string,
    orderSide: OrderSide,
    amount: number,
    order?: Order,
  ): Promise<Order | undefined> {
    // determine price and amount
    const currentPrice = await this.fetchOrderPrice(currencyPair, orderSide);
    const currencyAmount = orderSide == OrderSide.BUY ? amount / currentPrice : amount;

    const minAmount = await this.getMarkets().then((m) => m.find((m) => m.symbol === currencyPair).limits.amount.min);
    if (currencyAmount < minAmount) return undefined;

    // create a new order, if order undefined or price changed
    if (currentPrice != order?.price) {
      // cancel existing order
      if (order?.status === OrderStatus.OPEN) {
        await this.callApi((e) => e.cancelOrder(order.id, currencyPair));
      }

      console.log(`Creating new order (amount: ${currencyAmount}, price: ${currentPrice})`);
      return this.callApi((e) =>
        e.createOrder(currencyPair, orderType, orderSide, currencyAmount, currentPrice, {
          oflags: 'post',
        }),
      );
    }

    return order;
  }

  // other
  private async callApi<T>(action: (exchange: Exchange) => Promise<T>): Promise<T> {
    return action(this.exchange).catch((e: ExchangeError) => {
      throw new ServiceUnavailableException(e.message);
    });
  }

  getWeightedAveragePrice(list: any[]): { price: number; amountSum: number; feeSum: number } {
    const priceSum = list.reduce((a, b) => a + b.price * b.amount, 0);
    const amountSum = Util.round(list.reduce((a, b) => a + b.amount, 0), 8);
    const price = Util.round(priceSum / amountSum, 8);
    const feeSum = Util.round(list.reduce((a, b) => a + b.fee.cost, 0), 8);

    return { price, amountSum, feeSum };
  }
}
