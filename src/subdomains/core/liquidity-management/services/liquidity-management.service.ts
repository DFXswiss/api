import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { LiquidityBalance } from '../entities/liquidity-balance.entity';
import { LiquidityManagementOrder } from '../entities/liquidity-management-order.entity';
import { LiquidityManagementProcessor } from '../entities/liquidity-management-processor.entity';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';
import { LiquidityManagementOrderType } from '../enums';
import { LiquidityVerificationResult } from '../interfaces';
import { LiquidityManagementOrderRepository } from '../repositories/liquidity-management-order.repository';
import { LiquidityManagementRuleRepository } from '../repositories/liquidity-management-rule.repository';
import { LiquidityManagementBalanceService } from './liquidity-management-balance.service';

@Injectable()
export class LiquidityManagementService {
  constructor(
    private readonly ruleRepo: LiquidityManagementRuleRepository,
    private readonly orderRepo: LiquidityManagementOrderRepository,
    private readonly balanceService: LiquidityManagementBalanceService,
  ) {}

  @Interval(60000)
  async verifyRules() {
    const rules = await this.ruleRepo.find();
    const balances = await this.balanceService.refreshBalances(rules);

    for (const rule of rules) {
      try {
        const balance = this.balanceService.findRelevantBalance(rule, balances);
        await this.verifyRule(rule, balance);
      } catch (e) {}
    }
  }

  //*** HELPER METHODS ***//

  private async verifyRule(rule: LiquidityManagementRule, balance: LiquidityBalance): Promise<void> {
    const result = rule.verify(balance);

    if (!result.isOptimal) {
      await this.executeRule(rule, result);
    }
  }

  private async executeRule(rule: LiquidityManagementRule, result: LiquidityVerificationResult): Promise<void> {
    // choose which processor to pick this time
    for (const processor of rule.processors) {
      try {
        await this.createRelevantLiquidityOrder(rule, processor, result);
      } catch (e) {}
    }
  }

  private async createRelevantLiquidityOrder(
    rule: LiquidityManagementRule,
    processor: LiquidityManagementProcessor,
    result: LiquidityVerificationResult,
  ): Promise<void> {
    if (result.liquidityDeficit) {
      return this.placeLiquidityOrder(LiquidityManagementOrderType.BUY, result.liquidityDeficit, rule, processor);
    }

    if (result.liquiditySurplus) {
      return this.placeLiquidityOrder(LiquidityManagementOrderType.SELL, result.liquiditySurplus, rule, processor);
    }
  }

  private async placeLiquidityOrder(
    type: LiquidityManagementOrderType,
    amount: number,
    rule: LiquidityManagementRule,
    processor: LiquidityManagementProcessor,
  ): Promise<void> {
    const order = LiquidityManagementOrder.create(type, amount, rule, processor);

    await this.orderRepo.save(order);
  }
}
