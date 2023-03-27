import { Injectable } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { kucoin } from 'ccxt';
import { GetConfig } from 'src/config/config';

@Injectable()
export class KucoinService extends ExchangeService {
  constructor() {
    super(new kucoin(GetConfig().exchange));
  }
}
