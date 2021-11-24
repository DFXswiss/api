import { Injectable } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { Exchange, binance } from 'ccxt';

@Injectable()
export class BinanceService extends ExchangeService {
  constructor() {
    const params: Partial<Exchange> = {
      enableRateLimit: true,
    };
    super(new binance(params));
  }
}
