import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutEvmFactory } from '../payout-evm.factory';
import { IPayoutEvmService } from './payout-evm.interface';

export abstract class PayoutEvmProxyService implements IPayoutEvmService {
  protected abstract readonly blockchain: Blockchain;

  constructor(protected readonly factory: PayoutEvmFactory) {}

  private get service() {
    return this.factory.getPayoutService(this.blockchain);
  }

  async sendNativeCoin(address: string, amount: number, nonce?: number): Promise<string> {
    return this.service.sendNativeCoin(address, amount, nonce);
  }

  async sendToken(address: string, tokenName: Asset, amount: number, nonce?: number): Promise<string> {
    return this.service.sendToken(address, tokenName, amount, nonce);
  }

  async getPayoutCompletionData(txHash: string): Promise<[boolean, number]> {
    return this.service.getPayoutCompletionData(txHash);
  }

  async getCurrentGasForCoinTransaction(): Promise<number> {
    return this.service.getCurrentGasForCoinTransaction();
  }

  async getCurrentGasForTokenTransaction(token: Asset): Promise<number> {
    return this.service.getCurrentGasForTokenTransaction(token);
  }

  async getTxNonce(txHash: string): Promise<number> {
    return this.service.getTxNonce(txHash);
  }
}
