import { EvmClient, EvmClientParams } from './evm-client';

export abstract class EvmService {
  private readonly client: EvmClient;

  constructor(client: new (params) => EvmClient, params: EvmClientParams) {
    this.client = new client(params);
  }

  getDefaultClient<T extends EvmClient>(): T {
    return this.client as T;
  }
}
