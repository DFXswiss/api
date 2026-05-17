import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmService } from 'src/integration/blockchain/shared/evm/evm.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutTxStatus } from '../interfaces';

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

  async getPayoutCompletionData(txHash: string): Promise<PayoutTxStatus> {
    const receipt = await this.client.getTxReceipt(txHash);
    if (!receipt || receipt.confirmations <= 0) return { state: 'pending' };

    if (receipt.status === 1) {
      const fee = await this.client.getTxActualFee(txHash);
      return { state: 'complete', fee };
    }

    const tx = await this.client.getTx(txHash);
    const isOutOfGas = tx ? receipt.gasUsed.eq(tx.gasLimit) : false;
    return { state: 'failed', isOutOfGas };
  }

  async getCurrentGasCostForCoinTransaction(amount: number): Promise<number> {
    return this.client.getCurrentGasCostForCoinTransaction(amount);
  }

  async getCurrentGasCostForTokenTransaction(token: Asset, amount: number): Promise<number> {
    return this.client.getCurrentGasCostForTokenTransaction(token, amount);
  }

  async getTxNonce(txHash: string): Promise<number> {
    return this.client.getTxNonce(txHash);
  }

  async isTxExpired(txHash: string): Promise<boolean> {
    if (!(await this.isRpcSynced())) return false;

    const tx = await this.client.getTx(txHash);
    return tx === null;
  }

  private async isRpcSynced(maxAgeSeconds = 300): Promise<boolean> {
    const blockTimestamp = await this.client.getLatestBlockTimestamp();
    const blockAge = Date.now() / 1000 - blockTimestamp;
    return blockAge < maxAgeSeconds;
  }
}
