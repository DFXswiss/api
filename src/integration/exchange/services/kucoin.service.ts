import { Injectable } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { kucoin } from 'ccxt';
import { GetConfig } from 'src/config/config';
import { SchedulerRegistry } from '@nestjs/schedule';

@Injectable()
export class KucoinService extends ExchangeService {
  constructor(readonly scheduler: SchedulerRegistry) {
    super(new kucoin(GetConfig().exchange), scheduler);
  }
}
