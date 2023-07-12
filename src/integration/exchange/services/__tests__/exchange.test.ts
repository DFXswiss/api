import { Exchange } from 'ccxt';
import { ExchangeConfig } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { ExchangeService } from '../exchange.service';

export class TestExchange extends Exchange {
  constructor(config: ExchangeConfig) {
    super(config);
  }
}

export class TestExchangeService extends ExchangeService {
  protected logger = new DfxLogger(TestExchangeService);
}
