import { Injectable } from '@nestjs/common';
import { ArbitrumService } from '../../arbitrum/arbitrum.service';
import { BscService } from '../../bsc/bsc.service';
import { EthereumService } from '../../ethereum/ethereum.service';
import { OptimismService } from '../../optimism/optimism.service';
import { Blockchain } from '../enums/blockchain.enum';
import { EvmClient } from './evm-client';
import { EvmService } from './evm.service';
import { L2BridgeEvmClient } from './interfaces';

@Injectable()
export class EvmRegistryService {
  constructor(
    private readonly ethereumService: EthereumService,
    private readonly bscService: BscService,
    private readonly arbitrumService: ArbitrumService,
    private readonly optimismService: OptimismService,
  ) {}

  getClient(blockchain: Blockchain): EvmClient {
    return this.getService(blockchain).getDefaultClient();
  }

  getService(blockchain: Blockchain): EvmService {
    switch (blockchain) {
      case Blockchain.ETHEREUM:
        return this.ethereumService;
      case Blockchain.BINANCE_SMART_CHAIN:
        return this.bscService;
      case Blockchain.ARBITRUM:
        return this.arbitrumService;
      case Blockchain.OPTIMISM:
        return this.optimismService;

      default:
        throw new Error(`No evm service found for blockchain ${blockchain}`);
    }
  }

  getL2Client(blockchain: Blockchain): EvmClient & L2BridgeEvmClient {
    switch (blockchain) {
      case Blockchain.ARBITRUM:
        return this.arbitrumService.getDefaultClient();
      case Blockchain.OPTIMISM:
        return this.optimismService.getDefaultClient();

      default:
        throw new Error(`No l2 evm client found for blockchain ${blockchain}`);
    }
  }
}
