import { Injectable } from '@nestjs/common';
import { LiquidityManagementAction } from '../entities/liquidity-management-action.entity';
import { LiquidityActionIntegration } from '../interfaces';

@Injectable()
export class LiquidityActionIntegrationFactory {
  async getIntegration(action: LiquidityManagementAction): Promise<LiquidityActionIntegration> {}
}
