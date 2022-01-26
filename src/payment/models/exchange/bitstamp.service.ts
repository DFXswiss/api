import { Injectable } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { bitstamp } from 'ccxt';
import { Config } from 'src/config/config';

@Injectable()
export class BitstampService extends ExchangeService {
  constructor() {
    super(new bitstamp(Config.exchange));
  }
}
