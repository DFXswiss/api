import { ConstructorArgs, Exchange } from 'ccxt';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { ExchangeService } from '../exchange.service';

export class TestExchange extends Exchange {
  constructor(config: ConstructorArgs) {
    super(config);
  }
}

export class TestExchangeService extends ExchangeService {
  protected logger = new DfxLogger(TestExchangeService);

  protected networks: { [b in Blockchain]: string } = {
    Arbitrum: undefined,
    BinanceSmartChain: undefined,
    Bitcoin: undefined,
    Lightning: undefined,
    Monero: undefined,
    Zano: undefined,
    Cardano: undefined,
    DeFiChain: undefined,
    Ethereum: undefined,
    Sepolia: undefined,
    Optimism: undefined,
    Polygon: undefined,
    Base: undefined,
    Gnosis: undefined,
    Haqq: undefined,
    Liquid: undefined,
    Arweave: undefined,
    Railgun: undefined,
    BinancePay: undefined,
    KucoinPay: undefined,
    Solana: undefined,
    Tron: undefined,
    Spark: undefined,
    CitreaTestnet: undefined,
    Kraken: undefined,
    Binance: undefined,
    XT: undefined,
    MEXC: undefined,
    MaerkiBaumann: undefined,
    Olkypay: undefined,
    Checkout: undefined,
    Kaleido: undefined,
    Sumixx: undefined,
  };
}
