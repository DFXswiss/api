import { Injectable } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { binance } from 'ccxt';
import { GetConfig } from 'src/config/config';
import { SchedulerRegistry } from '@nestjs/schedule';

@Injectable()
export class BinanceService extends ExchangeService {
  constructor(readonly scheduler: SchedulerRegistry) {
    super(new binance(GetConfig().binance), scheduler);
  }
}
