import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmService } from 'src/integration/blockchain/shared/evm/evm.service';
import { Asset } from 'src/shared/models/asset/asset.entity';

export abstract class PayoutEvmService {
  private readonly client: EvmClient;

  constructor(service: EvmService) {
    this.client = service.getDefaultClient();
  }

  async sendNativeCoin(address: string, amount: number, nonce?: number): Promise<string> {
    return this.client.sendNativeCoinFromDex(address, amount, nonce);
  }

  async sendToken(address: string, tokenName: Asset, amount: number, nonce?: number): Promise<string> {
    return this.client.sendTokenFromDex(address, tokenName, amount, nonce);
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

  async getTxNonce(txHash: string): Promise<number> {
    return this.client.getTxNonce(txHash);
  }

  async isTxExpired(txHash: string): Promise<boolean> {
    const receipt = await this.client.getTxReceipt(txHash);
    if (receipt) return false; // TX was mined (success or fail)

    const tx = await this.client.getTx(txHash);
    return tx === null; // TX does not exist anymore -> expired
  }
}
