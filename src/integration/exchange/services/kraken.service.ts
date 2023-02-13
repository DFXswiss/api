import { Injectable } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { kraken } from 'ccxt';
import { GetConfig } from 'src/config/config';
import { SchedulerRegistry } from '@nestjs/schedule';

@Injectable()
export class KrakenService extends ExchangeService {
  constructor(readonly scheduler: SchedulerRegistry) {
    super(new kraken(GetConfig().kraken), scheduler);
  }
}
