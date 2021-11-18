import { Injectable } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { Exchange, kraken } from 'ccxt';

@Injectable()
export class KrakenService extends ExchangeService {
  constructor() {
    const params: Partial<Exchange> = {
      apiKey: process.env.KRAKEN_KEY,
      secret: process.env.KRAKEN_SECRET,
      enableRateLimit: true,
    };
    super(new kraken(params));
  }
}
