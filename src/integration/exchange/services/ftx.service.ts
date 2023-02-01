import { Injectable } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { ftx } from 'ccxt';
import { GetConfig } from 'src/config/config';
import { SchedulerRegistry } from '@nestjs/schedule';

@Injectable()
export class FtxService extends ExchangeService {
  constructor(readonly scheduler: SchedulerRegistry) {
    super(new ftx(GetConfig().exchange), scheduler);
  }
}
