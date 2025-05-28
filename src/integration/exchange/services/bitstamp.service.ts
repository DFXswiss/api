import { Injectable } from '@nestjs/common';
import { bitstamp } from 'ccxt';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { ExchangeService } from './exchange.service';

@Injectable()
export class BitstampService extends ExchangeService {
  protected readonly logger = new DfxLogger(BitstampService);

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
  };

  constructor() {
    super(bitstamp, GetConfig().exchange);
  }
}
