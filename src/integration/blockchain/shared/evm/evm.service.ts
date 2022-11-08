import { EvmClient } from './evm-client';

export abstract class EvmService {
  protected readonly client: EvmClient;

  constructor(
    gatewayUrl: string,
    apiKey: string,
    walletAddress: string,
    walletPrivateKey: string,
    swapContractAddress: string,
    swapTokenAddress: string,
    client: {
      new (
        gatewayUrl: string,
        privateKey: string,
        dfxAddress: string,
        swapContractAddress: string,
        swapTokenAddress: string,
      ): EvmClient;
    },
  ) {
    this.client = new client(
      `${gatewayUrl}/${apiKey}`,
      walletPrivateKey,
      walletAddress,
      swapContractAddress,
      swapTokenAddress,
    );
  }

  getDefaultClient<T extends EvmClient>(): T {
    return this.client as T;
  }
}
