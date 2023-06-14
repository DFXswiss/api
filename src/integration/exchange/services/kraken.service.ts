import { Injectable } from '@nestjs/common';
import { Order, kraken } from 'ccxt';
import { GetConfig } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { ExchangeService, OrderSide } from './exchange.service';

@Injectable()
export class KrakenService extends ExchangeService {
  protected readonly logger = new DfxLogger(KrakenService);

  constructor() {
    super(new kraken(GetConfig().kraken));
  }

  protected async createOrder(pair: string, direction: OrderSide, amount: number, price: number): Promise<Order> {
    return this.callApi((e) => e.createOrder(pair, 'limit', direction, amount, price, { oflags: 'post' }));
  }
}
