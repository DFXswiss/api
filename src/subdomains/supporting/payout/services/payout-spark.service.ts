import { Injectable } from '@nestjs/common';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { SparkService } from 'src/integration/blockchain/spark/spark.service';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { PayoutBroadcastException } from '../exceptions/payout-broadcast.exception';

@Injectable()
export class PayoutSparkService {
  constructor(private readonly sparkService: SparkService) {}

  async sendTransaction(address: string, amount: number): Promise<string> {
    try {
      const result = await this.sparkService.sendTransaction(address, amount);
      return result.txid;
    } catch (e) {
      if (e instanceof TxBroadcastError) throw new PayoutBroadcastException(e.message, { cause: e });
      throw e;
    }
  }

  async isHealthy(): Promise<boolean> {
    return this.sparkService.isHealthy();
  }

  async getPayoutCompletionData(payoutTxId: string): Promise<[boolean, number]> {
    const isComplete = await this.sparkService.getDefaultClient().isTxComplete(payoutTxId);
    const payoutFee = isComplete ? await this.sparkService.getTxActualFee(payoutTxId) : 0;

    return [isComplete, payoutFee];
  }

  getCurrentFeeForTransaction(token: Asset): Promise<number> {
    if (token.type !== AssetType.COIN) throw new Error('Method not implemented');

    return this.sparkService.getNativeFee();
  }
}
