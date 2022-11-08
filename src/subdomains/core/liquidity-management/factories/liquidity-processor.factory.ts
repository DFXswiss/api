import { Injectable } from '@nestjs/common';
import { LiquidityManagementAction } from '../entities/liquidity-management-action.entity';
import { LiquidityProcessor } from '../interfaces';

@Injectable()
export class LiquidityProcessorFactory {
  async getIntegration(processor: LiquidityManagementAction): LiquidityProcessor {}
}
