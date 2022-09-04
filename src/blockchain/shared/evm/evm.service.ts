import { EVMClient } from './evm-client';

export abstract class EVMService<T extends EVMClient> {
  protected readonly client: T;

  constructor(
    gatewayUrl: string,
    apiKey: string,
    walletAddress: string,
    walletPrivateKey: string,
    client: { new (gatewayUrl: string, privateKey: string, address: string): T },
  ) {
    this.client = new client(`${gatewayUrl}/${apiKey}`, walletAddress, walletPrivateKey);
  }

  getClient(): T {
    return this.client;
  }
}
