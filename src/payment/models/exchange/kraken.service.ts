import { Injectable } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { Exchange, kraken } from 'ccxt';

@Injectable()
export class KrakenService extends ExchangeService {
  constructor() {
    const params: Partial<Exchange> = {
      apiKey: 'TODO',
      secret: 'TODO',
      enableRateLimit: true,
    };
    super(new kraken(params));
  }
}
