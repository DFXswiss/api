import { BadRequestException } from '@nestjs/common';
import { Exchange, OrderBook, Order, WithdrawalResponse } from 'ccxt';
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

  constructor(exchange: Exchange) {
    this.exchange = exchange;
  }

  private async delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
        checkOrder = await this.exchange.fetchOrder(orderId, currencyPair);
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

  private async fetchOrderPrice(currencyPair: string, orderSide: OrderSide): Promise<number> {
    /* 
        If 'buy' we want to buy token1 using token2. Example BTC/EUR on 'buy' means we buy BTC using EUR
            > We want to have the highest 'bids' price in the orderbook
        If 'sell' we want to sell token1 using token2. Example BTC/EUR on 'sell' means we sell BTC using EUR
            > We want to have the lowest 'asks' price in the orderbook
    */
    const orderBook = await this.fetchOrderBook(currencyPair);
    return orderSide == OrderSide.BUY ? orderBook.bids[0][0] : orderBook.asks[0][0];
  }

  private async createOrder(
    currencyPair: string,
    orderType: string,
    orderSide: OrderSide,
    amount: number,
    order?: Order,
  ): Promise<Order> {
    const currentPrice = await this.fetchOrderPrice(currencyPair, orderSide);

    // create a new order, if order undefined or price changed
    if (currentPrice != order?.price) {

      // cancel existing order
      if (order?.status === OrderStatus.OPEN) {
        await this.exchange.cancelOrder(order.id, currencyPair);
      }

      return this.exchange.createOrder(currencyPair, orderType, orderSide, amount, currentPrice, {
        oflags: 'post',
      });
    }

    return order;
  }

  getWeightedAveragePrice(list: any[]): number {
    const price_sum = list.reduce((a, b) => a + (b.price*b.amount), 0);
    const price = price_sum / list.reduce((a, b) => a + b.amount, 0);

    return price;
  }

  private getPartialOrderResponse(order: Order): PartialOrderResponse {
    const partialOrder: PartialOrderResponse = {
      id: order.id,
      price: order.price,
      amount: order.filled,
      timestamp: order.timestamp,
      orderSide: order.side
    };

    return partialOrder;
  }

  private async tryToOrder(
    currencyPair: string,
    orderType: string,
    orderSide: OrderSide,
    amount: number
  ): Promise<OrderResponse> {
    const orderList = [];
    let order;

    do {
      // (re)create order
      order = await this.createOrder(currencyPair, orderType, orderSide, amount, order);

      // wait for completion
      order = await this.pollOrder(order.id, currencyPair);

      // check for partial orders
      if (order.status == OrderStatus.OPEN && order.filled) {
        orderList.push(this.getPartialOrderResponse(order));
        amount -= order.filled;
      }
    } while (order.status !== OrderStatus.CLOSED)

    // Push closed order
    orderList.push(this.getPartialOrderResponse(order));
    const price = this.getWeightedAveragePrice(orderList);

    return {
      orderSummary: {
        price: price,
        amount: order.amount,
        orderSide: order.side
      },
      orderList: orderList,
    };
  }

  async fetchBalances() {
    return this.exchange.fetchBalance();
  }

  async fetchOrderBook(currencyPair: string): Promise<OrderBook> {
    return this.exchange.fetchOrderBook(currencyPair);
  }

  getCurrencyPair(fromCurrency: string, toCurrency: string): { pair: string, direction: OrderSide } {
    this.exchange.fetch
    const currencyPairs = ['BTC/EUR'];
    const selectedPair = currencyPairs.find((p) => p.includes(fromCurrency) && p.includes(toCurrency));
    if (!selectedPair) throw new BadRequestException(`Pair with ${fromCurrency} and ${toCurrency} not supported`);

    const selectedDirection = selectedPair.startsWith(toCurrency) ? OrderSide.BUY : OrderSide.SELL;

    return { pair: selectedPair, direction: selectedDirection };
  }

  async swap(fromCurrency: string, toCurrency: string, amount: number): Promise<OrderResponse> {
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
    const balances = await this.fetchBalances();
    const { pair, direction } = this.getCurrencyPair(fromCurrency, toCurrency);

    if (amount > balances.total[fromCurrency]) {
      throw new BadRequestException(
        `There is not enough balance for token ${fromCurrency}. Current balance: ${balances.total[fromCurrency]} requested balance: ${amount}`,
      );
    }

    const currentPrice = await this.fetchOrderPrice(pair, direction);
    const currencyAmount = direction == OrderSide.BUY ? amount / currentPrice : amount;
    return this.tryToOrder(pair, 'limit', direction, currencyAmount);
  }

  async withdrawFunds(token: string, amount: number, address: string, params?: any): Promise<WithdrawalResponse> {
    /*
        Kraken requires you so store the address and give it a label (key). This needs to be added to the parameters
        await exchange.withdrawFunds('LTC', order.amount, 'xxx', {'key': 'cake-ltc'})
    */
    return this.exchange.withdraw(token, amount, address, undefined, params);
  }
}
