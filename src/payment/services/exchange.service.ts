import { Injectable, BadRequestException } from '@nestjs/common';
import { Exchange, OrderBook, Order, WithdrawalResponse, kraken } from 'ccxt';

enum OrderSide {
  BUY = 'buy',
  SELL = 'sell'
}

enum OrderStatus {
  OPEN = 'open',
  CLOSED = 'closed',
  CANCELED = 'canceled'
}

type KrakenOrder = {
  id: string,
  price: number,
  amount: number
}

type KrakenOrderResponse = {
  order: KrakenOrder;
  partialFills: KrakenOrder[];
}

@Injectable()
class ExchangeService {
  private readonly exchange: Exchange;

  constructor(exchange: Exchange) {
    this.exchange = exchange;
  }

  private async delay(ms: number) {
    return new Promise( resolve => setTimeout(resolve, ms) );
  }

  private async pollOrder(orderId: string, currencyPair: string, pollInterval = 5000, maxPollRetries = 12): Promise<OrderStatus> {
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
    } while (![OrderStatus.CLOSED, OrderStatus.CANCELED].includes(checkOrder.status as OrderStatus) && checkOrderCounter < maxPollRetries);

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
    return (orderSide == OrderSide.BUY) ? orderBook.bids[0][0] : orderBook.asks[0][0];
  }

  private async recreateOrder(order: Order, currencyPair: string, orderType: string, orderSide: OrderSide, wantedCurrencyAmount: number): Promise<Order> {
    const newPrice = await this.fetchOrderPrice(currencyPair, orderSide);
    if (newPrice != order.price) {
      await this.exchange.cancelOrder(order.id, currencyPair);
      return this.exchange.createOrder(currencyPair, orderType, orderSide, wantedCurrencyAmount, newPrice, {'oflags': 'post'});
    }

    return order;
  }

  private async tryToOrder(currencyPair: string, orderType: string, orderSide: OrderSide, wantedCurrencyAmount: number, currentPrice: number): Promise<KrakenOrderResponse> {
    const partialOrders = []
    let order = await this.exchange.createOrder(currencyPair, orderType, orderSide, wantedCurrencyAmount, currentPrice, {'oflags': 'post'});

    while(true) {
      const orderStatus = await this.pollOrder(order.id, currencyPair);
      if (orderStatus === OrderStatus.CLOSED) break;

      if (order.filled != undefined) {
        // Partial order exists
        const partialOrder: KrakenOrder = {
          id: order.id,
          price: order.price,
          amount: order.filled
        };

        partialOrders.push(partialOrder);
        wantedCurrencyAmount -= order.filled;
      }

      order = orderStatus == OrderStatus.CANCELED
        ? await this.exchange.createOrder(currencyPair, orderType, orderSide, wantedCurrencyAmount, currentPrice, {'oflags': 'post'})
        : await this.recreateOrder(order, currencyPair, orderType, orderSide, wantedCurrencyAmount);
    }

    let price = order.price;
    if (partialOrders.length > 0) {
      const price_sum = partialOrders.reduce((a, b) => a + b.price, 0);
      price = price_sum / partialOrders.length;
    }

    const krakenOrder: KrakenOrder = {
      id: order.id,
      price: price,
      amount: order.amount
    }
  
    const krakenResponse: KrakenOrderResponse = {
      order: krakenOrder,
      partialFills: partialOrders
    }

    return krakenResponse;
  }

  async fetchBalances() {
    return this.exchange.fetchBalance();
  }

  async fetchOrderBook(currencyPair: string): Promise<OrderBook> {
    return this.exchange.fetchOrderBook(currencyPair);
  }

  async currencyPairFromTo(fromCurrency: string, toCurrency: string): Promise<[string, OrderSide]> {
    const currencyPairs = ['BTC/EUR', 'LTC/EUR']
    const selectedPair = currencyPairs.find((p) => p.includes(fromCurrency.toUpperCase()) && p.includes(toCurrency.toUpperCase()));
    const selectedDirection = selectedPair.startsWith(toCurrency) ? OrderSide.BUY : OrderSide.SELL;


    if (!selectedPair || !selectedDirection)
      throw new BadRequestException(`Pair with ${fromCurrency} and ${toCurrency} not supported`);

    return [selectedPair, selectedDirection];
  }

  async createOrder(from: string, to: string, exchangeAmount: number): Promise<KrakenOrderResponse> {
    /*
      The following logic is applied

      1. place order
      2. query every 5s if order has been filled up to 60s
      3. if after 60s order is not filled then cancel order and go back to 1.)
      4. if after 60s order is partially filled then cancel order and go back to 1 with the remaining funds that were not filled
      5. return buy/sell price. If partially filled then return average price over all the orders
    */
    const balances = await this.fetchBalances();
    const [currencyPair, orderSide] = await this.currencyPairFromTo(from, to);

    if (exchangeAmount > balances.total[from]) {
      throw new BadRequestException(`There is not enough balance for token ${from}. Current balance: ${balances.total[from]} requested balance: ${exchangeAmount}`);
    }

    const currentPrice = await this.fetchOrderPrice(currencyPair, orderSide);
    const wantedCurrencyAmount = (orderSide == OrderSide.BUY) ? exchangeAmount / currentPrice: exchangeAmount;
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

export class Kraken extends ExchangeService {
  constructor(params: any) {
    super(new kraken(params));
  }
}