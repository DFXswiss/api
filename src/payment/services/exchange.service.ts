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
    let order: Order;
    let orderStatus: OrderStatus;
    let partialOrders = []

    do {
      if (order == undefined) {
        order = await this.exchange.createOrder(currencyPair, orderType, orderSide, wantedCurrencyAmount, currentPrice, {'oflags': 'post'});
      } else {
        // cancel existing order. Check if partially filled
        if (orderStatus == OrderStatus.CANCELED) {
          // recreate order
          order = await this.exchange.createOrder(currencyPair, orderType, orderSide, wantedCurrencyAmount, currentPrice, {'oflags': 'post'});
        } else {
          // Order has not yet been filled. Lets check if it was partially filled
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

          order = await this.recreateOrder(order, currencyPair, orderType, orderSide, wantedCurrencyAmount);
        }
      }

      orderStatus = await this.pollOrder(order.id, currencyPair);
    } while ([OrderStatus.OPEN, OrderStatus.CANCELED].includes(orderStatus));

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

  async createOrder(orderSide: OrderSide, currencyPair: string, exchangeAmount: number): Promise<KrakenOrderResponse> {
    /*
      The following logic is applied

      1. place order
      2. query every 5s if order has been filled up to 60s
      3. if after 60s order is not filled then cancel order and go back to 1.)
      4. if after 60s order is partially filled then cancel order and go back to 1 with the remaining funds that were not filled
      5. return buy/sell price. If partially filled then return average price over all the orders
    */
    const balances = await this.fetchBalances();
    const [token1, token2] = currencyPair.split('/');
    const depositedToken = (orderSide == OrderSide.BUY) ? token2 : token1;

    if (exchangeAmount > balances.total[depositedToken]) {
      throw new BadRequestException(`There is not enough balance for token ${depositedToken}. Current balance: ${balances.total[depositedToken]} requested balance: ${exchangeAmount}`);
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