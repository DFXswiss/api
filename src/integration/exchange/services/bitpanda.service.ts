import { Injectable } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { bitpanda } from 'ccxt';
import { GetConfig } from 'src/config/config';
import { SchedulerRegistry } from '@nestjs/schedule';

@Injectable()
export class BitpandaService extends ExchangeService {
  constructor(readonly scheduler: SchedulerRegistry) {
    super(new bitpanda(GetConfig().exchange), scheduler);
  }
}
