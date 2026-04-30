import { BlockchainClient } from './blockchain-client';

export abstract class BlockchainService {
  abstract getDefaultClient(): BlockchainClient;
}
