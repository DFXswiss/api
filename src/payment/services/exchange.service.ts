import { Injectable } from '@nestjs/common';
import { Exchange, OrderBook, Order, Balances, kraken } from 'ccxt';

enum OrderSide {
  BUY = 'buy',
  SELL = 'sell'
}

@Injectable()
class ExchangeService {
  private readonly _exchange: Exchange;
  public balances: Promise<any>;

  constructor(exchange: Exchange) {
      this._exchange = exchange;
      this.balances = this.updateBalances();
  }

  async updateBalances(): Promise<Balances> {
      return this._exchange.fetchBalance();
  }

  async fetchBalances() {
     return this.balances;
  }

  async fetchOrderBook(currencyPair: string): Promise<OrderBook> {
      return this._exchange.fetchOrderBook(currencyPair);
  }

  async createOrder(orderSide: OrderSide, currencyPair: string, exchangeAmount: number): Promise<Order> {
      const orderbook = await this.fetchOrderBook(currencyPair);

      /* 
          If 'buy' we want to buy token1 using token2. Example BTC/EUR on 'buy' means we buy BTC using EUR
              > We want to have the highest 'bids' price in the orderbook
          If 'sell' we want to sell token1 using token2. Example BTC/EUR on 'sell' means we sell BTC using EUR
              > We want to have the lowest 'asks' price in the orderbook
      */
      const currentPrice = (orderSide == OrderSide.BUY) ? orderbook.bids[0][0] : orderbook.asks[0][0];
      const wantedCurrencyAmount = (orderSide == OrderSide.BUY) ? exchangeAmount / currentPrice: exchangeAmount;
      const order = await this._exchange.createOrder(currencyPair, 'limit', orderSide, wantedCurrencyAmount, currentPrice, {'oflags': 'post'});

      let checkOrder = await this._exchange.fetchOrder(order.id, currencyPair)
      let checkOrderCounter = 0

      while (!['closed', 'canceled'].includes(checkOrder.status) && checkOrderCounter < 100) {
          checkOrder = await this._exchange.fetchOrder(order.id, currencyPair)
          checkOrderCounter++;
      }

      // Retry
      if (checkOrder.status == 'canceled') {
          console.log("Order was canceled! Lets try again");
          return this.createOrder(orderSide, currencyPair, exchangeAmount);
      }

      // TODO: What if order was partially filled?
      // TODO: Check if we have enough balance?
      // TODO: How many retries?

      return order;
  }
}

class Kraken extends ExchangeService {
  constructor(params: any) {
      super(new kraken(params));
  }
}