import { Injectable } from '@nestjs/common';
import { binance } from 'ccxt';
import { GetConfig } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { ExchangeService } from './exchange.service';

@Injectable()
export class BinanceService extends ExchangeService {
  protected readonly logger = new DfxLogger(BinanceService);

  constructor() {
    super(binance, GetConfig().binance);
  }
}
