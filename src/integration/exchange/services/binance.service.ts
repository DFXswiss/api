import { Injectable } from '@nestjs/common';
import { binance } from 'ccxt';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { ExchangeService } from './exchange.service';

@Injectable()
export class BinanceService extends ExchangeService {
  protected readonly logger = new DfxLogger(BinanceService);

  protected networks: { [b in Blockchain]: string } = {
    Arbitrum: 'ARBITRUM',
    BinanceSmartChain: 'BSC',
    Bitcoin: 'BTC',
    Lightning: undefined,
    Monero: 'XMR',
    Zano: undefined,
    Cardano: undefined,
    DeFiChain: undefined,
    Ethereum: 'ETH',
    Sepolia: undefined,
    Optimism: 'OPTIMISM',
    Polygon: 'MATIC',
    Base: 'BASE',
    Gnosis: undefined,
    Haqq: undefined,
    Liquid: undefined,
    Arweave: undefined,
    Railgun: undefined,
    BinancePay: undefined,
    KucoinPay: undefined,
    Solana: 'SOL',
    Tron: 'TRX',
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

  constructor() {
    super(binance, GetConfig().binance);
  }
}
