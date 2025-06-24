import { Injectable } from '@nestjs/common';
import { bitpanda } from 'ccxt';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { ExchangeService } from './exchange.service';

@Injectable()
export class BitpandaService extends ExchangeService {
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
    Gnosis: undefined,
    Haqq: undefined,
    Liquid: undefined,
    Arweave: undefined,
    Railgun: undefined,
    BinancePay: undefined,
    Solana: undefined,
  };

  constructor(private readonly dfxLogger: DfxLoggerService) {
    super(bitpanda, GetConfig().exchange);

    this.logger = this.dfxLogger.create(BitpandaService);
  }
}
