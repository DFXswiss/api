import { Injectable } from '@nestjs/common';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';
import { LiquidityBalanceIntegration } from '../interfaces';

@Injectable()
export class LiquidityBalanceIntegrationFactory {
  getIntegration(rule: LiquidityManagementRule): LiquidityBalanceIntegration {
    return null;
  }
}
