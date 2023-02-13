import { Injectable } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { bitstamp } from 'ccxt';
import { GetConfig } from 'src/config/config';
import { SchedulerRegistry } from '@nestjs/schedule';

@Injectable()
export class BitstampService extends ExchangeService {
  constructor(readonly scheduler: SchedulerRegistry) {
    super(new bitstamp(GetConfig().exchange), scheduler);
  }
}
