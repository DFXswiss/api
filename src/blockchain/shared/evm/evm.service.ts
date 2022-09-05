import { EVMClient } from './evm-client';

export abstract class EVMService {
  protected readonly client: EVMClient;

  constructor(
    gatewayUrl: string,
    apiKey: string,
    walletAddress: string,
    walletPrivateKey: string,
    client: { new (gatewayUrl: string, privateKey: string, address: string): EVMClient },
  ) {
    this.client = new client(`${gatewayUrl}/${apiKey}`, walletPrivateKey, walletAddress);
  }

  getDefaultClient<T extends EVMClient>(): T {
    return this.client as T;
  }
}
