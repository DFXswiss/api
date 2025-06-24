import { Injectable } from '@nestjs/common';
import { binance } from 'ccxt';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { ExchangeService } from './exchange.service';

@Injectable()
export class BinanceService extends ExchangeService {
  protected readonly logger: DfxLoggerService;

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

  constructor(private readonly dfxLogger: DfxLoggerService) {
    super(binance, GetConfig().binance);

    this.logger = this.dfxLogger.create(BinanceService);
  }
}
