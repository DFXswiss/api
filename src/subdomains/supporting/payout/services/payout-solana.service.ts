import { Injectable } from '@nestjs/common';
import { SolanaService } from 'src/integration/blockchain/solana/services/solana.service';
import { SolanaClient } from 'src/integration/blockchain/solana/solana-client';
import { Asset } from 'src/shared/models/asset/asset.entity';

@Injectable()
export class PayoutSolanaService {
  private readonly client: SolanaClient;

  constructor(solanaService: SolanaService) {
    this.client = solanaService.getDefaultClient();
  }

  async sendNativeCoin(address: string, amount: number): Promise<string> {
    return this.client.sendNativeCoinFromDex(address, amount);
  }

  async sendToken(address: string, token: Asset, amount: number) {
    return this.client.sendTokenFromDex(address, token, amount);
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
