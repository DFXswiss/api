import { Injectable } from '@nestjs/common';
import { ExchangeService, OrderSide } from './exchange.service';
import { Order, kraken } from 'ccxt';
import { GetConfig } from 'src/config/config';

@Injectable()
export class KrakenService extends ExchangeService {
  constructor() {
    super(new kraken(GetConfig().kraken));
  }

  protected async createOrder(pair: string, direction: OrderSide, amount: number, price: number): Promise<Order> {
    return this.callApi((e) => e.createOrder(pair, 'limit', direction, amount, price, { oflags: 'post' }));
  }
}
