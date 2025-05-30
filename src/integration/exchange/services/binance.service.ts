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
    Cardano: undefined,
    DeFiChain: undefined,
    Ethereum: 'ETH',
    Optimism: 'OPTIMISM',
    Polygon: 'MATIC',
    Base: 'BASE',
    Haqq: undefined,
    Liquid: undefined,
    Arweave: undefined,
    Railgun: undefined,
    Solana: undefined,
  };

  constructor() {
    super(binance, GetConfig().binance);
  }
}
