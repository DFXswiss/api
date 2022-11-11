import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Lock } from 'src/shared/utils/lock';
import { LiquidityBalance } from '../entities/liquidity-balance.entity';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';
import { LiquidityManagementPipelineStatus, LiquidityManagementRuleStatus } from '../enums';
import { LiquidityVerificationResult } from '../interfaces';
import { LiquidityManagementRuleRepository } from '../repositories/liquidity-management-rule.repository';
import { LiquidityManagementBalanceService } from './liquidity-management-balance.service';
import { LiquidityManagementPipelineRepository } from '../repositories/liquidity-management-pipeline.repository';
import { LiquidityManagementPipeline } from '../entities/liquidity-management-pipeline.entity';

@Injectable()
export class LiquidityManagementService {
  private readonly verifyRulesLock = new Lock(1800);

  constructor(
    private readonly ruleRepo: LiquidityManagementRuleRepository,
    private readonly pipelineRepo: LiquidityManagementPipelineRepository,
    private readonly balanceService: LiquidityManagementBalanceService,
  ) {}

  @Interval(60000)
  async verifyRules() {
    if (!this.verifyRulesLock.acquire()) return;

    try {
      const rules = await this.ruleRepo.find({ status: LiquidityManagementRuleStatus.ACTIVE });
      const balances = await this.balanceService.refreshBalances(rules);

      for (const rule of rules) {
        await this.verifyRule(rule, balances);
      }
    } catch (e) {
      console.error('Error in verifying the liquidity management rules', e);
    } finally {
      this.verifyRulesLock.release();
    }
  }

  //*** HELPER METHODS ***//

  private async verifyRule(rule: LiquidityManagementRule, balances: LiquidityBalance[]): Promise<void> {
    try {
      const balance = this.balanceService.findRelevantBalance(rule, balances);
      const result = rule.verify(balance);

      if (!result.isOptimal) {
        await this.executeRule(rule, result);
      }
    } catch (e) {
      console.error(`Error in verifying the liquidity management rule id: ${rule.id}`, e);
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
