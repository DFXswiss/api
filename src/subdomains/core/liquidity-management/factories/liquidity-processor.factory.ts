import { Injectable } from '@nestjs/common';
import { LiquidityManagementProcessor } from '../entities/liquidity-management-processor.entity';
import { LiquidityProcessor } from '../interfaces';

@Injectable()
export class LiquidityProcessorFactory {
  async getIntegration(processor: LiquidityManagementProcessor): LiquidityProcessor {}
}
