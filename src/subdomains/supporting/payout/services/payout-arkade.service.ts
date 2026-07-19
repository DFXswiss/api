import { Injectable } from '@nestjs/common';
import { ArkadeService } from 'src/integration/blockchain/arkade/arkade.service';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { PayoutBroadcastException } from '../exceptions/payout-broadcast.exception';

@Injectable()
export class PayoutArkadeService {
  constructor(private readonly arkadeService: ArkadeService) {}

  async sendTransaction(address: string, amount: number): Promise<string> {
    try {
      const result = await this.arkadeService.sendTransaction(address, amount);
      return result.txid;
    } catch (e) {
      if (e instanceof TxBroadcastError) throw new PayoutBroadcastException(e.message, { cause: e });
      throw e;
    }
  }

  async isHealthy(): Promise<boolean> {
    return this.arkadeService.isHealthy();
  }

  async getPayoutCompletionData(payoutTxId: string): Promise<[boolean, number]> {
    const isComplete = await this.arkadeService.getDefaultClient().isTxComplete(payoutTxId);
    const payoutFee = isComplete ? await this.arkadeService.getTxActualFee(payoutTxId) : 0;

    return [isComplete, payoutFee];
  }

  getCurrentFeeForTransaction(token: Asset): Promise<number> {
    if (token.type !== AssetType.COIN) throw new Error('Method not implemented');

    return this.arkadeService.getNativeFee();
  }
}
