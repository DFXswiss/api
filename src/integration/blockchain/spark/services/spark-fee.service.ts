import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { SparkNodeType, SparkService } from '../spark.service';

export enum SparkFeeTarget {
  SLOW = 12,    // ~2 hours
  NORMAL = 6,   // ~1 hour
  FAST = 2,     // ~20 minutes
  INSTANT = 1,  // Next block
}

@Injectable()
export class SparkFeeService {
  private readonly logger = new DfxLogger(SparkFeeService);

  // Transaction size constants (in vBytes)
  private readonly OVERHEAD_SIZE = 10; // Version, locktime, etc.
  private readonly INPUT_SIZE = 148; // Typical P2PKH input
  private readonly OUTPUT_SIZE = 34; // Typical P2PKH output
  private readonly WITNESS_DISCOUNT = 0.25; // Witness data counts as 1/4

  constructor(private readonly sparkService: SparkService) {}

  async getRecommendedFeeRate(target: SparkFeeTarget = SparkFeeTarget.NORMAL): Promise<number> {
    try {
      const client = this.sparkService.getDefaultClient(SparkNodeType.OUTPUT);
      const estimate = await client.estimateFee(target);

      // Convert from SPARK/kB to sat/vByte
      const feeRateInSatPerVByte = Math.ceil(estimate.feerate * 100000);

      this.logger.verbose(`Recommended fee rate for ${target} blocks: ${feeRateInSatPerVByte} sat/vByte`);

      return feeRateInSatPerVByte;
    } catch (error) {
      this.logger.error('Failed to get recommended fee rate, using fallback:', error);
      return this.getFallbackFeeRate(target);
    }
  }

  async getCurrentFeeRate(): Promise<number> {
    return this.getRecommendedFeeRate(SparkFeeTarget.NORMAL);
  }

  async getFastFeeRate(): Promise<number> {
    return this.getRecommendedFeeRate(SparkFeeTarget.FAST);
  }

  async getSlowFeeRate(): Promise<number> {
    return this.getRecommendedFeeRate(SparkFeeTarget.SLOW);
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
    const feeInSatoshi = sizeInVBytes * feeRatePerVByte;
    // Convert satoshi to SPARK (1 SPARK = 100,000,000 satoshi)
    return Util.round(feeInSatoshi / 100000000, 8);
  }

  async estimateTransactionFee(
    inputCount: number,
    outputCount: number,
    target: SparkFeeTarget = SparkFeeTarget.NORMAL,
  ): Promise<{ fee: number; feeRate: number; size: number }> {
    const size = this.calculateTransactionSize(inputCount, outputCount);
    const feeRate = await this.getRecommendedFeeRate(target);
    const fee = this.calculateFee(size, feeRate);

    return { fee, feeRate, size };
  }

  async estimateBatchTransactionFee(
    outputCount: number,
    target: SparkFeeTarget = SparkFeeTarget.NORMAL,
  ): Promise<{ fee: number; feeRate: number; size: number }> {
    // Estimate inputs based on typical UTXO set
    // Assume we need 1 input per 10 outputs (can be adjusted based on actual UTXO distribution)
    const estimatedInputCount = Math.max(1, Math.ceil(outputCount / 10));

    return this.estimateTransactionFee(estimatedInputCount, outputCount, target);
  }

  private getFallbackFeeRate(target: SparkFeeTarget): number {
    // Fallback fee rates in sat/vByte
    switch (target) {
      case SparkFeeTarget.INSTANT:
        return 50;
      case SparkFeeTarget.FAST:
        return 30;
      case SparkFeeTarget.NORMAL:
        return 15;
      case SparkFeeTarget.SLOW:
        return 5;
      default:
        return 15;
    }
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