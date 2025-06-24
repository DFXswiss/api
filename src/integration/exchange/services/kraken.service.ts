import { Injectable } from '@nestjs/common';
import { kraken } from 'ccxt';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { ExchangeService } from './exchange.service';

@Injectable()
export class KrakenService extends ExchangeService {
  protected networks: { [b in Blockchain]: string } = {
    Arbitrum: 'arbitrum',
    BinanceSmartChain: 'bsc',
    Bitcoin: 'bitcoin',
    Lightning: undefined,
    Monero: 'monero',
    Cardano: 'cardano',
    DeFiChain: 'defichain',
    Ethereum: 'ethereum',
    Optimism: 'optimism',
    Polygon: 'polygon',
    Base: undefined,
    Gnosis: undefined,
    Haqq: undefined,
    Liquid: undefined,
    Arweave: undefined,
    Railgun: undefined,
    BinancePay: undefined,
    Solana: undefined,
  };

  constructor(protected readonly logger: DfxLoggerService) {
    super(kraken, GetConfig().kraken);
    this.logger.create(KrakenService);
  }
}
