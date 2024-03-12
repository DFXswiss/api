import { NativeCurrency } from '@uniswap/sdk-core';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { EvmClient, EvmClientParams } from './evm-client';
import { EvmUtil } from './evm.util';

export abstract class EvmService {
  private readonly client: EvmClient;

  constructor(client: new (params) => EvmClient, params: EvmClientParams) {
    this.client = new client(params);
  }

  getDefaultClient<T extends EvmClient>(): T {
    return this.client as T;
  }

  async getPaymentRequest(address: string, asset: Asset, amount: number): Promise<string> {
    const token = await this.client.getToken(asset);
    return token instanceof NativeCurrency
      ? `ethereum:${address}@${token.chainId}?value=${EvmUtil.toWeiAmount(amount).toString()}`
      : `ethereum:${token.address}@${token.chainId}/transfer?address=${address}&uint256=${EvmUtil.toWeiAmount(
          amount,
          token.decimals,
        ).toString()}`;
  }
}
