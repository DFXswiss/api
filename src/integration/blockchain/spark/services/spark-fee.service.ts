import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';

export enum SparkFeeTarget {
  SLOW = 12,    // ~2 hours
  NORMAL = 6,   // ~1 hour
  FAST = 2,     // ~20 minutes
  INSTANT = 1,  // Next block
}

@Injectable()
export class SparkFeeService {
  private readonly logger = new DfxLogger(SparkFeeService);

  // Transaction size constants (in vBytes) - kept for reference
  // SPARK-to-SPARK transfers are fee-free on Layer 2
  private readonly OVERHEAD_SIZE = 10; // Version, locktime, etc.
  private readonly INPUT_SIZE = 148; // Typical P2PKH input
  private readonly OUTPUT_SIZE = 34; // Typical P2PKH output
  private readonly WITNESS_DISCOUNT = 0.25; // Witness data counts as 1/4

  constructor() {}

  async getRecommendedFeeRate(target: SparkFeeTarget = SparkFeeTarget.NORMAL): Promise<number> {
    // SPARK-to-SPARK transfers are fee-free on Layer 2
    // Return 0 as we only use SPARK for SPARK-to-SPARK transfers
    this.logger.verbose(`SPARK-to-SPARK transfers are fee-free, returning 0 sat/vByte`);
    return 0;
  }

  async getCurrentFeeRate(): Promise<number> {
    // SPARK-to-SPARK transfers are fee-free
    return 0;
  }

  async getFastFeeRate(): Promise<number> {
    // SPARK-to-SPARK transfers are fee-free
    return 0;
  }

  async getSlowFeeRate(): Promise<number> {
    // SPARK-to-SPARK transfers are fee-free
    return 0;
  }

  calculateTransactionSize(inputCount: number, outputCount: number, hasWitness = true): number {
    let size = this.OVERHEAD_SIZE;
    size += inputCount * this.INPUT_SIZE;
    size += outputCount * this.OUTPUT_SIZE;

    if (hasWitness) {
      // Apply witness discount for SegWit transactions
      const witnessSize = inputCount * 107; // Typical witness data per input
      const nonWitnessSize = size;
      size = nonWitnessSize + (witnessSize * this.WITNESS_DISCOUNT);
    }

    return Math.ceil(size);
  }

  calculateFee(sizeInVBytes: number, feeRatePerVByte: number): number {
    // SPARK-to-SPARK transfers are fee-free on Layer 2
    // Return 0 as we only use SPARK for SPARK-to-SPARK transfers
    return 0;
  }

  async estimateTransactionFee(
    inputCount: number,
    outputCount: number,
    target: SparkFeeTarget = SparkFeeTarget.NORMAL,
  ): Promise<{ fee: number; feeRate: number; size: number }> {
    const size = this.calculateTransactionSize(inputCount, outputCount);
    // SPARK-to-SPARK transfers are fee-free
    const feeRate = 0;
    const fee = 0;

    return { fee, feeRate, size };
  }

  async estimateBatchTransactionFee(
    outputCount: number,
    target: SparkFeeTarget = SparkFeeTarget.NORMAL,
  ): Promise<{ fee: number; feeRate: number; size: number }> {
    // Estimate inputs based on typical UTXO set
    const estimatedInputCount = Math.max(1, Math.ceil(outputCount / 10));
    const size = this.calculateTransactionSize(estimatedInputCount, outputCount);

    // SPARK-to-SPARK transfers are fee-free on Layer 2
    return { fee: 0, feeRate: 0, size };
  }

  private getFallbackFeeRate(target: SparkFeeTarget): number {
    // SPARK-to-SPARK transfers are fee-free on Layer 2
    // Return 0 for all targets as we only use SPARK for SPARK-to-SPARK transfers
    return 0;
  }

  async validateFeeRate(feeRate: number): Promise<boolean> {
    // Validate that fee rate is within reasonable bounds
    const minFeeRate = 1; // 1 sat/vByte minimum
    const maxFeeRate = 1000; // 1000 sat/vByte maximum (protection against fee spikes)

    if (feeRate < minFeeRate) {
      this.logger.warn(`Fee rate ${feeRate} is below minimum ${minFeeRate}`);
      return false;
    }

    if (feeRate > maxFeeRate) {
      this.logger.warn(`Fee rate ${feeRate} exceeds maximum ${maxFeeRate}`);
      return false;
    }

    return true;
  }

  async getHistoricalFeeRates(blocks: number[] = [1, 6, 12, 24]): Promise<Map<number, number>> {
    const feeRates = new Map<number, number>();

    for (const blockTarget of blocks) {
      try {
        const rate = await this.getRecommendedFeeRate(blockTarget as SparkFeeTarget);
        feeRates.set(blockTarget, rate);
      } catch (error) {
        this.logger.warn(`Failed to get fee rate for ${blockTarget} blocks:`, error);
        feeRates.set(blockTarget, this.getFallbackFeeRate(blockTarget as SparkFeeTarget));
      }
    }

    return feeRates;
  }
}