import { Injectable } from '@nestjs/common';
import { SparkService } from 'src/integration/blockchain/spark/spark.service';
import { PayoutOrderContext } from '../entities/payout-order.entity';
import { PayoutBitcoinBasedService, PayoutGroup } from './base/payout-bitcoin-based.service';

@Injectable()
export class PayoutSparkService extends PayoutBitcoinBasedService {
  constructor(private readonly sparkService: SparkService) {
    super();
  }

  async isHealthy(): Promise<boolean> {
    return this.sparkService.isHealthy().catch(() => false);
  }

  async sendUtxoToMany(_context: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    return this.sparkService.getDefaultClient().sendMany(payout, 0);
  }

  async getPayoutCompletionData(_context: PayoutOrderContext, payoutTxId: string): Promise<[boolean, number]> {
    const tx = await this.sparkService.getDefaultClient().getTransaction(payoutTxId);
    return [!!(tx && tx.confirmations === 1), 0];
  }

  async getCurrentFeeRate(): Promise<number> {
    return 0;
  }

  getBatchSize(): number {
    return 100;
  }
}