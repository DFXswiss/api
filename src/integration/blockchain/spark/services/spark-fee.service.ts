import { Injectable } from '@nestjs/common';

// SPARK Layer-2 has no transaction fees
@Injectable()
export class SparkFeeService {
  async getRecommendedFeeRate(): Promise<number> {
    return 0;
  }
}