import { EvmClient } from './evm-client';

export abstract class EvmService {
  protected readonly client: EvmClient;

  constructor(
    scanApiUrl: string,
    scanApiKey: string,
    gatewayUrl: string,
    apiKey: string,
    walletAddress: string,
    walletPrivateKey: string,
    swapContractAddress: string,
    swapTokenAddress: string,
    client: {
      new (
        scanApiUrl: string,
        scanApiKey: string,
        gatewayUrl: string,
        privateKey: string,
        dfxAddress: string,
        swapContractAddress: string,
        swapTokenAddress: string,
      ): EvmClient;
    },
  ) {
    this.client = new client(
      scanApiUrl,
      scanApiKey,
      `${gatewayUrl}/${apiKey ?? ''}`,
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
