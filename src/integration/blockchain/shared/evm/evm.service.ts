import { HttpService } from 'src/shared/services/http.service';
import { EvmClient } from './evm-client';
import { ChainId } from '@uniswap/smart-order-router';

export abstract class EvmService {
  protected readonly client: EvmClient;

  constructor(
    http: HttpService,
    scanApiUrl: string,
    scanApiKey: string,
    gatewayUrl: string,
    apiKey: string,
    walletPrivateKey: string,
    chainId: ChainId,
    client: {
      new (
        http: HttpService,
        scanApiUrl: string,
        scanApiKey: string,
        gatewayUrl: string,
        privateKey: string,
        chainId: ChainId,
      ): EvmClient;
    },
  ) {
    this.client = new client(http, scanApiUrl, scanApiKey, `${gatewayUrl}/${apiKey ?? ''}`, walletPrivateKey, chainId);
  }

  getDefaultClient<T extends EvmClient>(): T {
    return this.client as T;
  }
}
