import { Injectable } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { bitpanda } from 'ccxt';
import { GetConfig } from 'src/config/config';

@Injectable()
export class BitpandaService extends ExchangeService {
  constructor() {
    super(new bitpanda(GetConfig().exchange));
  }
}
