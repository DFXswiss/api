import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { EvmClient, EvmClientParams } from './evm-client';

export abstract class EvmService {
  private readonly client: EvmClient;

  constructor(client: new (params) => EvmClient, params: EvmClientParams) {
    this.client = new client(params);
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
