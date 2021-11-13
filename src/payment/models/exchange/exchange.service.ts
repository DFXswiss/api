import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Exchange, Order, WithdrawalResponse } from 'ccxt';
import { OrderResponse, PartialOrderResponse } from './dto/order-response.dto';

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
  private readonly exchange: Exchange;
  private currencyPairs: string[];

  constructor(exchange: Exchange) {
    this.exchange = exchange;
  }

  async fetchBalances() {
    return this.callApi((e) => e.fetchBalance());
  }

  async trade(fromCurrency: string, toCurrency: string, amount: number): Promise<OrderResponse> {
    fromCurrency = fromCurrency.toUpperCase();
    toCurrency = toCurrency.toUpperCase();

    /*
      The following logic is applied

      1. place order
      2. query every 5s if order has been filled up to 60s
      3. if after 60s order is not filled then cancel order and go back to 1.)
      4. if after 60s order is partially filled then cancel order and go back to 1 with the remaining funds that were not filled
      5. return buy/sell price. If partially filled then return average price over all the orders
    */

    // check balance
    const balances = await this.fetchBalances();
    if (amount > balances.total[fromCurrency]) {
      throw new BadRequestException(
        `There is not enough balance for token ${fromCurrency}. Current balance: ${balances.total[fromCurrency]} requested balance: ${amount}`,
      );
    }

    // place the order
    const { pair, direction } = await this.getCurrencyPair(fromCurrency, toCurrency);
    return this.tryToOrder(pair, 'limit', direction, amount);
  }

  async withdrawFunds(token: string, amount: number, address: string, key: string): Promise<WithdrawalResponse> {
    /*
        Kraken requires you so store the address and give it a label (key). This needs to be added to the parameters
        await exchange.withdrawFunds('LTC', order.amount, 'xxx', {'key': 'cake-ltc'})
    */
    return this.callApi((e) => e.withdraw(token, amount, address, undefined, { key }));
  }

  // --- Helper Methods --- //
  // currency pairs
  private async getCurrencyPairs(): Promise<string[]> {
    if (!this.currencyPairs) {
      this.currencyPairs = await this.callApi((e) => e.fetchMarkets().then((l) => l.map((m) => m.symbol)));
    }

    return this.currencyPairs;
  }

  async getCurrencyPair(fromCurrency: string, toCurrency: string): Promise<{ pair: string; direction: OrderSide }> {
    const currencyPairs = await this.getCurrencyPairs();
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
  ): Promise<OrderResponse> {
    const orderList: PartialOrderResponse[] = [];
    let order: Order;
    let numRetries = 0;

    do {
      // (re)create order
      order = await this.createOrder(currencyPair, orderType, orderSide, amount, order);

      // wait for completion
      order = await this.pollOrder(order.id, currencyPair);

      // check for partial orders
      if (order.status != OrderStatus.CANCELED && order.filled) {
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
    } while (order.status !== OrderStatus.CLOSED && numRetries < maxRetries);

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
  ): Promise<Order> {
    // determine price and amount
    const currentPrice = await this.fetchOrderPrice(currencyPair, orderSide);
    const currencyAmount = orderSide == OrderSide.BUY ? amount / currentPrice : amount;

    // create a new order, if order undefined or price changed
    if (currentPrice != order?.price) {
      // cancel existing order
      if (order?.status === OrderStatus.OPEN) {
        await this.callApi((e) => e.cancelOrder(order.id, currencyPair));
      }

      return this.callApi((e) =>
        e.createOrder(currencyPair, orderType, orderSide, currencyAmount, currentPrice, {
          oflags: 'post',
        }),
      );
    }

    return order;
  }

  private async pollOrder(
    orderId: string,
    currencyPair: string,
    pollInterval = 5000,
    maxPollRetries = 24,
  ): Promise<Order> {
    let checkOrder: Order;
    let checkOrderCounter = 0;

    do {
      await this.delay(pollInterval);
      try {
        checkOrder = await this.callApi((e) => e.fetchOrder(orderId, currencyPair));
        checkOrderCounter++;
      } catch (e) {
        continue;
      }
    } while (
      ![OrderStatus.CLOSED, OrderStatus.CANCELED].includes(checkOrder.status as OrderStatus) &&
      checkOrderCounter < maxPollRetries
    );

    return checkOrder;
  }

  // other
  private async callApi<T>(action: (exchange: Exchange) => Promise<T>): Promise<T> {
    return action(this.exchange).catch((e) => {
      throw new ServiceUnavailableException(e);
    });
  }

  private async delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getWeightedAveragePrice(list: any[]): { price: number; amountSum: number; feeSum: number } {
    const priceSum = list.reduce((a, b) => a + b.price * b.amount, 0);
    const amountSum = list.reduce((a, b) => a + b.amount, 0);
    const price = priceSum / amountSum;
    const feeSum = list.reduce((a, b) => a + b.fee.cost, 0);

    return { price, amountSum, feeSum };
  }
}
