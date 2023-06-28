import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmService } from 'src/integration/blockchain/shared/evm/evm.service';
import { Asset } from 'src/shared/models/asset/asset.entity';

export abstract class PayoutEvmService {
  protected client: EvmClient;

  constructor(protected readonly service: EvmService) {
    this.client = service.getDefaultClient();
  }

  async sendNativeCoin(address: string, amount: number): Promise<string> {
    return this.client.sendNativeCoinFromDex(address, amount);
  }

  async sendToken(address: string, tokenName: Asset, amount: number): Promise<string> {
    return this.client.sendTokenFromDex(address, tokenName, amount);
  }

  async getPayoutCompletionData(txHash: string): Promise<[boolean, number]> {
    const isComplete = await this.client.isTxComplete(txHash);
    const payoutFee = isComplete ? await this.client.getTxActualFee(txHash) : 0;

    return [isComplete, payoutFee];
  }

  async getCurrentGasForCoinTransaction(): Promise<number> {
    return this.client.getCurrentGasCostForCoinTransaction();
  }

  async getCurrentGasForTokenTransaction(token: Asset): Promise<number> {
    return this.client.getCurrentGasCostForTokenTransaction(token);
  }
}
