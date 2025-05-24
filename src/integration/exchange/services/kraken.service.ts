import { Injectable } from '@nestjs/common';
import { kraken } from 'ccxt';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { ExchangeService } from './exchange.service';

@Injectable()
export class KrakenService extends ExchangeService {
  protected readonly logger = new DfxLogger(KrakenService);

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
    Haqq: undefined,
    Liquid: undefined,
    Arweave: undefined,
    Railgun: undefined,
    BinancePay: undefined,
  };

  constructor() {
    super(kraken, GetConfig().kraken);
  }
}
