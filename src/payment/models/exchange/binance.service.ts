import { Injectable } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { binance } from 'ccxt';
import { GetConfig } from 'src/config/config';

@Injectable()
export class BinanceService extends ExchangeService {
  constructor() {
    super(new binance(GetConfig().binance));
  }
}
