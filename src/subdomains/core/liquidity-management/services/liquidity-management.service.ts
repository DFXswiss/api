import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { LiquidityBalance } from '../entities/liquidity-balance.entity';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';
import { LiquidityManagementPipelineStatus } from '../enums';
import { LiquidityVerificationResult } from '../interfaces';
import { LiquidityManagementRuleRepository } from '../repositories/liquidity-management-rule.repository';
import { LiquidityManagementBalanceService } from './liquidity-management-balance.service';
import { LiquidityManagementPipelineRepository } from '../repositories/liquidity-management-pipeline.repository';
import { LiquidityManagementPipeline } from '../entities/liquidity-management-pipeline.entity';

@Injectable()
export class LiquidityManagementService {
  constructor(
    private readonly ruleRepo: LiquidityManagementRuleRepository,
    private readonly pipelineRepo: LiquidityManagementPipelineRepository,
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
      } catch (e) {
        console.error(`Error in verifying the liquidity management rule id: ${rule.id}`, e);
        continue;
      }
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
    if (await this.findExistingPipeline(rule)) return;

    const newPipeline = LiquidityManagementPipeline.create(rule, result);
    await this.pipelineRepo.save(newPipeline);
  }

  private findExistingPipeline(rule: LiquidityManagementRule): Promise<LiquidityManagementPipeline | undefined> {
    return this.pipelineRepo.findOne({
      where: [
        {
          rule,
          status: LiquidityManagementPipelineStatus.CREATED,
        },
        {
          rule,
          status: LiquidityManagementPipelineStatus.IN_PROGRESS,
        },
      ],
    });
  }
}
