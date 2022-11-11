import { Injectable } from '@nestjs/common';
import { LiquidityManagementAction } from '../entities/liquidity-management-action.entity';
import { LiquidityActionIntegration } from '../interfaces';

@Injectable()
export class LiquidityActionIntegrationFactory {
  getIntegration(action: LiquidityManagementAction): LiquidityActionIntegration {
    return null;
  }
}
