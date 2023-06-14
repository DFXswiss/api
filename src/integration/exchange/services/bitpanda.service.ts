import { Injectable } from '@nestjs/common';
import { bitpanda } from 'ccxt';
import { GetConfig } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { ExchangeService } from './exchange.service';

@Injectable()
export class BitpandaService extends ExchangeService {
  protected readonly logger = new DfxLogger(BitpandaService);

  constructor() {
    super(new bitpanda(GetConfig().exchange));
  }
}
