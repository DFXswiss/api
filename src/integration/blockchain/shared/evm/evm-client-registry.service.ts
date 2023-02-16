import { Injectable } from '@nestjs/common';
import { ArbitrumClient } from '../../arbitrum/arbitrum-client';
import { OptimismClient } from '../../optimism/optimism-client';
import { Blockchain } from '../enums/blockchain.enum';
import { L2BridgeEvmClient } from './interfaces';

@Injectable()
export class EvmClientRegistryService {
  constructor(private readonly arbitrumClient: ArbitrumClient, private readonly optimismClient: OptimismClient) {}

  getL2BridgeEvmClient(blockchain: Blockchain): L2BridgeEvmClient {
    switch (blockchain) {
      case Blockchain.ARBITRUM:
        return this.arbitrumClient;

      case Blockchain.OPTIMISM:
        return this.optimismClient;

      default:
        throw new Error(`L2 EVM Bridge is not supported for blockchain ${blockchain}`);
    }
  }
}
