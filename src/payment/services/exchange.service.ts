import { Injectable } from '@nestjs/common';
import { Exchange, OrderBook, Order, Balances, kraken, WithdrawalResponse } from 'ccxt';

enum OrderSide {
  BUY = 'buy',
  SELL = 'sell',
}

@Injectable()
export class ExchangeService {
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

  private _delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async _pollOrder(
    orderId: string,
    currencyPair: string,
    pollInterval = 5000,
    maxPollRetries = 720,
  ): Promise<string> {
    let checkOrder: Order;
    let checkOrderCounter = 0;

    do {
      this._delay(pollInterval);
      checkOrder = await this._exchange.fetchOrder(orderId, currencyPair);
      checkOrderCounter++;
    } while (!['closed', 'canceled'].includes(checkOrder.status) && checkOrderCounter < maxPollRetries);

    return checkOrder.status;
  }

  private async _tryToOrder(
    currencyPair: string,
    orderType: string,
    orderSide: OrderSide,
    wantedCurrencyAmount: number,
    currentPrice: number,
    maxRetries = 5,
  ): Promise<Order> {
    let order: Order;
    let orderStatus: string;
    let orderRetryCounter = 0;

    do {
      order = await this._exchange.createOrder(currencyPair, orderType, orderSide, wantedCurrencyAmount, currentPrice, {
        oflags: 'post',
      });
      orderStatus = await this._pollOrder(order.id, currencyPair);
      orderRetryCounter++;
    } while (orderStatus == 'canceled');

    return order;
  }

  async createOrder(orderSide: OrderSide, currencyPair: string, exchangeAmount: number): Promise<Order> {
    const balances = await this.balances;
    const orderBook = await this.fetchOrderBook(currencyPair);
    const [token1, token2] = currencyPair.split('/');
    const depositedToken = orderSide == OrderSide.BUY ? token2 : token1;

    if (exchangeAmount > balances.total[depositedToken]) {
      throw new Error('There is not enough balance for token ' + depositedToken);
    }

    /* 
        If 'buy' we want to buy token1 using token2. Example BTC/EUR on 'buy' means we buy BTC using EUR
            > We want to have the highest 'bids' price in the orderbook
        If 'sell' we want to sell token1 using token2. Example BTC/EUR on 'sell' means we sell BTC using EUR
            > We want to have the lowest 'asks' price in the orderbook
    */
    const currentPrice = orderSide == OrderSide.BUY ? orderBook.bids[0][0] : orderBook.asks[0][0];
    const wantedCurrencyAmount = orderSide == OrderSide.BUY ? exchangeAmount / currentPrice : exchangeAmount;
    return this._tryToOrder(currencyPair, 'limit', orderSide, wantedCurrencyAmount, currentPrice);

    // TODO: What if order was partially filled and our retry times out?
  }

  async withdrawFunds(token: string, amount: number, address: string, params?: any): Promise<WithdrawalResponse> {
    /*
        Kraken requires you so store the address and give it a label (key). This needs to be added to the parameters
        await exchange.withdrawFunds('LTC', order.amount, 'xxx', {'key': 'cake-ltc'})
    */
    return this._exchange.withdraw(token, amount, address, undefined, params);
  }
}

class Kraken extends ExchangeService {
  constructor(params: any) {
    super(new kraken(params));
  }
}
