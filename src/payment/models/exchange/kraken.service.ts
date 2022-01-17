import { Injectable } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { kraken } from 'ccxt';
import { Config } from 'src/config/config';

@Injectable()
export class KrakenService extends ExchangeService {
  constructor() {
    super(new kraken(Config.kraken));
  }
}
