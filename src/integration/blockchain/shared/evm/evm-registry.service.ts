import { Injectable } from '@nestjs/common';
import { ArbitrumService } from '../../arbitrum/arbitrum.service';
import { BscService } from '../../bsc/bsc.service';
import { EthereumService } from '../../ethereum/ethereum.service';
import { OptimismService } from '../../optimism/optimism.service';
import { Blockchain } from '../enums/blockchain.enum';
import { EvmClient } from './evm-client';

@Injectable()
export class EvmRegistryService {
  constructor(
    private readonly ethereumService: EthereumService,
    private readonly bscService: BscService,
    private readonly arbitrumService: ArbitrumService,
    private readonly optimismService: OptimismService,
  ) {}

  getClient(blockchain: Blockchain): EvmClient {
    switch (blockchain) {
      case Blockchain.ETHEREUM:
        return this.ethereumService.getDefaultClient();
      case Blockchain.BINANCE_SMART_CHAIN:
        return this.bscService.getDefaultClient();
      case Blockchain.ARBITRUM:
        return this.arbitrumService.getDefaultClient();
      case Blockchain.OPTIMISM:
        return this.optimismService.getDefaultClient();

      default:
        throw new Error(`No evm client found for blockchain ${blockchain}`);
    }
  }
}
