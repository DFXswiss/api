import { EvmClient } from './evm-client';

export abstract class EvmService {
  protected readonly client: EvmClient;

  constructor(
    gatewayUrl: string,
    apiKey: string,
    walletAddress: string,
    walletPrivateKey: string,
    client: { new (gatewayUrl: string, privateKey: string, address: string): EvmClient },
  ) {
    this.client = new client(`${gatewayUrl}/${apiKey}`, walletPrivateKey, walletAddress);
  }

  getDefaultClient<T extends EvmClient>(): T {
    return this.client as T;
  }
}
