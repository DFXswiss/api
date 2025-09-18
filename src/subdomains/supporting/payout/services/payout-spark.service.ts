import { Injectable } from '@nestjs/common';
import { SparkService } from 'src/integration/blockchain/spark/spark.service';
import { SparkFeeService, SparkFeeTarget } from 'src/integration/blockchain/spark/services/spark-fee.service';
import { SparkClient } from 'src/integration/blockchain/spark/spark-client';
import { PayoutOrderContext } from '../entities/payout-order.entity';
import { PayoutBitcoinBasedService, PayoutGroup } from './base/payout-bitcoin-based.service';

@Injectable()
export class PayoutSparkService extends PayoutBitcoinBasedService {
  private readonly client: SparkClient;

  constructor(
    private readonly sparkService: SparkService,
    private readonly feeService: SparkFeeService,
  ) {
    super();
    this.client = sparkService.getDefaultClient();
  }

  async isHealthy(): Promise<boolean> {
    try {
      return await this.sparkService.isHealthy();
    } catch {
      return false;
    }
  }

  async sendUtxoToMany(_context: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    // SPARK-to-SPARK transfers are fee-free, so we pass 0 as fee rate
    const feeRate = 0;

    // Convert PayoutGroup to format expected by SparkClient
    const outputs: { addressTo: string; amount: number }[] = [];

    for (const [addressTo, amount] of Object.entries(payout)) {
      outputs.push({
        addressTo,
        amount: typeof amount === 'string' ? parseFloat(amount) : Number(amount),
      });
    }

    return this.client.sendMany(outputs, feeRate);
  }

  async getPayoutCompletionData(_context: PayoutOrderContext, payoutTxId: string): Promise<[boolean, number]> {
    const transaction = await this.client.getTransaction(payoutTxId);

    // SPARK has binary confirmation: confirmed (1) or pending (0)
    const isComplete = transaction && transaction.confirmations === 1;
    // SPARK-to-SPARK transfers are fee-free on Layer 2
    const payoutFee = 0;

    return [isComplete, payoutFee];
  }

  async getCurrentFeeRate(): Promise<number> {
    // SPARK-to-SPARK transfers are fee-free on Layer 2
    return 0;
  }

  async estimateFee(outputCount: number): Promise<number> {
    // SPARK-to-SPARK transfers are fee-free on Layer 2
    return 0;
  }

  async validateAddress(address: string): Promise<boolean> {
    return this.sparkService.validateAddress(address);
  }

  async getBalance(address?: string): Promise<number> {
    return this.sparkService.getBalance(address);
  }

  async getConfirmationCount(txId: string): Promise<number> {
    try {
      const transaction = await this.client.getTransaction(txId);
      // SPARK has binary status: return 1 if confirmed, 0 if pending
      // There is no "confirmation count" in Layer-2 - transactions are either final or not
      return transaction?.confirmations ?? 0;
    } catch {
      return 0;
    }
  }

  // Helper method for batch size optimization
  getBatchSize(): number {
    // Spark can handle similar batch sizes to Bitcoin
    // Limiting to 100 outputs per transaction for safety
    return 100;
  }
}