import { Injectable } from '@nestjs/common';
import { kucoin } from 'ccxt';
import { GetConfig } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { ExchangeService } from './exchange.service';

@Injectable()
export class KucoinService extends ExchangeService {
  protected readonly logger = new DfxLogger(KucoinService);

  constructor() {
    super(kucoin, GetConfig().exchange);
  }
}
