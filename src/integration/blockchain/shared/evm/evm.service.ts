import { ChainId } from '@uniswap/sdk-core';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
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

  async getPaymentRequest(address: string, asset: Asset, amount: number): Promise<string> {
    const token = await this.client.getTokenByAddress(asset.chainId);
    return asset.type === AssetType.COIN
      ? `ethereum:${address}@${token.chainId}?value=${this.client.toWeiAmount(amount).toString()}`
      : `ethereum:${token.address}@${token.chainId}/transfer?address=${address}&uint256=${this.client
          .toWeiAmount(amount, token.decimals)
          .toString()}`;
  }
}
