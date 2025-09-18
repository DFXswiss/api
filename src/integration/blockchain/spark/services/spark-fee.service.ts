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

  constructor() {}

  async getRecommendedFeeRate(_target: SparkFeeTarget = SparkFeeTarget.NORMAL): Promise<number> {
    // SPARK-to-SPARK transfers are fee-free on Layer 2
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

  calculateFee(_sizeInVBytes: number, _feeRatePerVByte: number): number {
    // SPARK-to-SPARK transfers are fee-free on Layer 2
    return 0;
  }

  async estimateTransactionFee(
    _inputCount: number,
    _outputCount: number,
    _target: SparkFeeTarget = SparkFeeTarget.NORMAL,
  ): Promise<{ fee: number; feeRate: number; size: number }> {
    // SPARK-to-SPARK transfers are fee-free
    return { fee: 0, feeRate: 0, size: 0 };
  }

  async estimateBatchTransactionFee(
    _outputCount: number,
    _target: SparkFeeTarget = SparkFeeTarget.NORMAL,
  ): Promise<{ fee: number; feeRate: number; size: number }> {
    // SPARK-to-SPARK transfers are fee-free on Layer 2
    return { fee: 0, feeRate: 0, size: 0 };
  }

}