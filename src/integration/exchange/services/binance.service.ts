import { Injectable } from '@nestjs/common';
import { binance } from 'ccxt';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { ExchangeService } from './exchange.service';

@Injectable()
export class BinanceService extends ExchangeService {
  protected readonly logger: DfxLogger;

  protected networks: { [b in Blockchain]: string } = {
    Arbitrum: 'ARBITRUM',
    BinanceSmartChain: 'BSC',
    Bitcoin: 'BTC',
    Lightning: undefined,
    Monero: 'XMR',
    Cardano: undefined,
    DeFiChain: undefined,
    Ethereum: 'ETH',
    Optimism: 'OPTIMISM',
    Polygon: 'MATIC',
    Base: 'BASE',
    Gnosis: undefined,
    Haqq: undefined,
    Liquid: undefined,
    Arweave: undefined,
    Railgun: undefined,
    BinancePay: undefined,
    Solana: 'SOL',
  };

  constructor(readonly loggerFactory: LoggerFactory) {
    super(binance, GetConfig().binance);

    this.logger = this.loggerFactory.create(BinanceService);
  }
}
