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
    maxPollRetries = 12,
  ): Promise<OrderStatus> {
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

    return checkOrder.status as OrderStatus;
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

  private async recreateOrder(
    order: Order,
    currencyPair: string,
    orderType: string,
    orderSide: OrderSide,
    wantedCurrencyAmount: number,
  ): Promise<Order> {
    const newPrice = await this.fetchOrderPrice(currencyPair, orderSide);
    if (newPrice != order.price) {
      await this.exchange.cancelOrder(order.id, currencyPair);
      return this.exchange.createOrder(currencyPair, orderType, orderSide, wantedCurrencyAmount, newPrice, {
        oflags: 'post',
      });
    }

    return order;
  }

  private async tryToOrder(
    currencyPair: string,
    orderType: string,
    orderSide: OrderSide,
    wantedCurrencyAmount: number,
    currentPrice: number,
  ): Promise<OrderResponse> {
    const partialOrders = [];
    let order = await this.exchange.createOrder(
      currencyPair,
      orderType,
      orderSide,
      wantedCurrencyAmount,
      currentPrice,
      { oflags: 'post' },
    );

    while (true) {
      const orderStatus = await this.pollOrder(order.id, currencyPair);
      if (orderStatus === OrderStatus.CLOSED) break;

      if (order.filled != undefined) {
        // Partial order exists
        const partialOrder: PartialOrderResponse = {
          id: order.id,
          price: order.price,
          amount: order.filled,
        };

        partialOrders.push(partialOrder);
        wantedCurrencyAmount -= order.filled;
      }

      order =
        orderStatus == OrderStatus.CANCELED
          ? await this.exchange.createOrder(currencyPair, orderType, orderSide, wantedCurrencyAmount, currentPrice, {
              oflags: 'post',
            })
          : await this.recreateOrder(order, currencyPair, orderType, orderSide, wantedCurrencyAmount);
    }

    let price = order.price;
    if (partialOrders.length > 0) {
      const price_sum = partialOrders.reduce((a, b) => a + b.price, 0);
      price = price_sum / partialOrders.length;
    }

    const krakenOrder: PartialOrderResponse = {
      id: order.id,
      price: price,
      amount: order.amount,
    };

    const krakenResponse: OrderResponse = {
      order: krakenOrder,
      partialFills: partialOrders,
    };

    return krakenResponse;
  }

  async fetchBalances() {
    return this.exchange.fetchBalance();
  }

  async fetchOrderBook(currencyPair: string): Promise<OrderBook> {
    return this.exchange.fetchOrderBook(currencyPair);
  }

  currencyPairFromTo(fromCurrency: string, toCurrency: string): [string, OrderSide] {
    const currencyPairs = ['BTC/EUR', 'LTC/EUR']; // TODO
    const selectedPair = currencyPairs.find((p) => p.includes(fromCurrency) && p.includes(toCurrency));
    if (!selectedPair) throw new BadRequestException(`Pair with ${fromCurrency} and ${toCurrency} not supported`);

    const selectedDirection = selectedPair.startsWith(toCurrency) ? OrderSide.BUY : OrderSide.SELL;

    return [selectedPair, selectedDirection];
  }

  async createOrder(fromCurrency: string, toCurrency: string, exchangeAmount: number): Promise<OrderResponse> {
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
    const [currencyPair, orderSide] = this.currencyPairFromTo(fromCurrency, toCurrency);

    if (exchangeAmount > balances.total[fromCurrency]) {
      throw new BadRequestException(
        `There is not enough balance for token ${fromCurrency}. Current balance: ${balances.total[fromCurrency]} requested balance: ${exchangeAmount}`,
      );
    }

    const currentPrice = await this.fetchOrderPrice(currencyPair, orderSide);
    const wantedCurrencyAmount = orderSide == OrderSide.BUY ? exchangeAmount / currentPrice : exchangeAmount;
    return this.tryToOrder(currencyPair, 'limit', orderSide, wantedCurrencyAmount, currentPrice);
  }

  async withdrawFunds(token: string, amount: number, address: string, params?: any): Promise<WithdrawalResponse> {
    /*
        Kraken requires you so store the address and give it a label (key). This needs to be added to the parameters
        await exchange.withdrawFunds('LTC', order.amount, 'xxx', {'key': 'cake-ltc'})
    */
    return this.exchange.withdraw(token, amount, address, undefined, params);
  }
}
