import { HttpService } from 'src/shared/services/http.service';
import { EvmClient } from './evm-client';

export abstract class EvmService {
  protected readonly client: EvmClient;

  constructor(
    http: HttpService,
    scanApiUrl: string,
    scanApiKey: string,
    gatewayUrl: string,
    apiKey: string,
    walletPrivateKey: string,
    swapContractAddress: string,
    swapTokenAddress: string,
    client: {
      new (
        http: HttpService,
        scanApiUrl: string,
        scanApiKey: string,
        gatewayUrl: string,
        privateKey: string,
        swapContractAddress: string,
        swapTokenAddress: string,
      ): EvmClient;
    },
  ) {
    this.client = new client(
      http,
      scanApiUrl,
      scanApiKey,
      `${gatewayUrl}/${apiKey ?? ''}`,
      walletPrivateKey,
      swapContractAddress,
      swapTokenAddress,
    );
  }

  getDefaultClient<T extends EvmClient>(): T {
    return this.client as T;
  }
}
