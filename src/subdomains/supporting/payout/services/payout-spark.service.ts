import { Injectable } from '@nestjs/common';
import { SparkNodeType, SparkService } from 'src/integration/blockchain/spark/spark.service';
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
    this.client = sparkService.getDefaultClient(SparkNodeType.OUTPUT);
  }

  async isHealthy(): Promise<boolean> {
    try {
      return await this.sparkService.isHealthy();
    } catch {
      return false;
    }
  }

  async sendUtxoToMany(_context: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    const feeRate = await this.getCurrentFeeRate();

    // Convert PayoutGroup to format expected by SparkClient
    const outputs = Object.entries(payout).map(([addressTo, amount]) => ({
      addressTo,
      amount: typeof amount === 'string' ? parseFloat(amount) : amount,
    }));

    return this.client.sendMany(outputs, feeRate);
  }

  async getPayoutCompletionData(_context: PayoutOrderContext, payoutTxId: string): Promise<[boolean, number]> {
    const transaction = await this.client.getTransaction(payoutTxId);

    const isComplete = transaction && transaction.blockhash && transaction.confirmations > 0;
    const payoutFee = isComplete && transaction.fee ? Math.abs(transaction.fee) : 0;

    return [isComplete, payoutFee];
  }

  async getCurrentFeeRate(): Promise<number> {
    // Get recommended fee rate and apply a multiplier for priority
    const baseFeeRate = await this.feeService.getRecommendedFeeRate(SparkFeeTarget.NORMAL);

    // Apply 1.5x multiplier for higher priority (similar to Bitcoin implementation)
    return Math.ceil(baseFeeRate * 1.5);
  }

  async estimateFee(outputCount: number): Promise<number> {
    const feeEstimate = await this.feeService.estimateBatchTransactionFee(
      outputCount,
      SparkFeeTarget.NORMAL
    );
    return feeEstimate.fee;
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