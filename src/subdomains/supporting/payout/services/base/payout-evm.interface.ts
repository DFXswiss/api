import { Asset } from 'src/shared/models/asset/asset.entity';

export interface IPayoutEvmService {
  sendNativeCoin(address: string, amount: number, nonce?: number): Promise<string>;
  sendToken(address: string, tokenName: Asset, amount: number, nonce?: number): Promise<string>;
  getPayoutCompletionData(txHash: string): Promise<[boolean, number]>;
  getCurrentGasForCoinTransaction(): Promise<number>;
  getCurrentGasForTokenTransaction(token: Asset): Promise<number>;
  getTxNonce(txHash: string): Promise<number>;
}
