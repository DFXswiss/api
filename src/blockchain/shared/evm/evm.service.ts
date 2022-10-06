import { EvmClient } from './evm-client';

export abstract class EvmService {
  protected readonly client: EvmClient;

  constructor(
    gatewayUrl: string,
    apiKey: string,
    walletAddress: string,
    walletPrivateKey: string,
    swapContractAddress: string,
    client: {
      new (gatewayUrl: string, privateKey: string, dfxAddress: string, swapContractAddress: string): EvmClient;
    },
  ) {
    this.client = new client(`${gatewayUrl}/${apiKey}`, walletPrivateKey, walletAddress, swapContractAddress);
  }

  getDefaultClient<T extends EvmClient>(): T {
    return this.client as T;
  }
}
