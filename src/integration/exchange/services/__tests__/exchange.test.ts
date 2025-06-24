import { Exchange } from 'ccxt';
import { ExchangeConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { ExchangeService } from '../exchange.service';

export class TestExchange extends Exchange {
  constructor(config: ExchangeConfig) {
    super(config);
  }
}

export class TestExchangeService extends ExchangeService {
  protected readonly logger: DfxLoggerService;

  protected networks: { [b in Blockchain]: string } = {
    Arbitrum: undefined,
    BinanceSmartChain: undefined,
    Bitcoin: undefined,
    Lightning: undefined,
    Monero: undefined,
    Cardano: undefined,
    DeFiChain: undefined,
    Ethereum: undefined,
    Optimism: undefined,
    Polygon: undefined,
    Base: undefined,
    Haqq: undefined,
    Liquid: undefined,
    Arweave: undefined,
    Railgun: undefined,
    BinancePay: undefined,
    Solana: undefined,
    Gnosis: undefined,
  };
}
