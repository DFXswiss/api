import { BlockchainService } from '../util/blockchain.service';
import { EvmClient, EvmClientParams } from './evm-client';

export abstract class EvmService extends BlockchainService {
  private readonly client: EvmClient;

  constructor(client: new (params: EvmClientParams) => EvmClient, params: EvmClientParams) {
    super();
    this.client = new client(params);
  }

  getDefaultClient<T extends EvmClient>(): T {
    return this.client as T;
  }
}
