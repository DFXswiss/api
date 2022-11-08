import { Injectable } from '@nestjs/common';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';
import { LiquidityBalanceProvider } from '../interfaces';

@Injectable()
export class LiquidityBalanceFactory {
  async getIntegration(rule: LiquidityManagementRule): LiquidityBalanceProvider {}
}
