import { Injectable } from '@nestjs/common';
import { bitstamp } from 'ccxt';
import { GetConfig } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { ExchangeService } from './exchange.service';

@Injectable()
export class BitstampService extends ExchangeService {
  protected readonly logger = new DfxLogger(BitstampService);

  constructor() {
    super(bitstamp, GetConfig().exchange);
  }
}
