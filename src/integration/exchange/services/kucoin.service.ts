import { Injectable } from '@nestjs/common';
import { kucoin } from 'ccxt';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { ExchangeService } from './exchange.service';

@Injectable()
export class KucoinService extends ExchangeService {
  protected readonly logger: DfxLogger;
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
    Gnosis: undefined,
    Haqq: undefined,
    Liquid: undefined,
    Arweave: undefined,
    Railgun: undefined,
    BinancePay: undefined,
    Solana: undefined,
  };

  constructor(protected readonly loggerFactory: LoggerFactory) {
    super(kucoin, GetConfig().exchange);

    this.logger = loggerFactory.create(KucoinService);
  }
}
