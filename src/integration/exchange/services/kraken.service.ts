import { Injectable } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { kraken } from 'ccxt';
import { GetConfig } from 'src/config/config';

@Injectable()
export class KrakenService extends ExchangeService {
  constructor() {
    super(new kraken(GetConfig().kraken));
  }
}
