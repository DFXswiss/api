import { Injectable } from '@nestjs/common';
import { ArkService } from 'src/integration/blockchain/ark/ark.service';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';

@Injectable()
export class PayoutArkService {
  constructor(private readonly arkService: ArkService) {}

  async sendTransaction(address: string, amount: number): Promise<string> {
    return this.arkService.sendTransaction(address, amount).then((r) => r.txid);
  }

  async isHealthy(): Promise<boolean> {
    return this.arkService.isHealthy();
  }

  async getPayoutCompletionData(payoutTxId: string): Promise<[boolean, number]> {
    const isComplete = await this.arkService.getDefaultClient().isTxComplete(payoutTxId);
    const payoutFee = isComplete ? await this.arkService.getTxActualFee(payoutTxId) : 0;

    return [isComplete, payoutFee];
  }

  getCurrentFeeForTransaction(token: Asset): Promise<number> {
    if (token.type !== AssetType.COIN) throw new Error('Method not implemented');

    return this.arkService.getNativeFee();
  }
}
