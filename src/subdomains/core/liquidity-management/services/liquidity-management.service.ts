import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
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
  constructor(
    private readonly ruleRepo: LiquidityManagementRuleRepository,
    private readonly pipelineRepo: LiquidityManagementPipelineRepository,
    private readonly balanceService: LiquidityManagementBalanceService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async verifyRules() {
    const rules = await this.ruleRepo.find({ status: LiquidityManagementRuleStatus.ACTIVE });
    const balances = await this.balanceService.refreshBalances(rules);

    for (const rule of rules) {
      await this.verifyRule(rule, balances);
    }
  }

  //*** HELPER METHODS ***//

  private async verifyRule(rule: LiquidityManagementRule, balances: LiquidityBalance[]): Promise<void> {
    try {
      const balance = this.balanceService.findRelevantBalance(rule, balances);

      if (!balance) throw new Error('Could not proceed with rule verification, balance not found.');

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

    this.logRuleExecution(rule, result);

    rule.processing();
    await this.ruleRepo.save(rule);

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

  private logRuleExecution(rule: LiquidityManagementRule, result: LiquidityVerificationResult): void {
    const deficitMessage = `${result.liquidityDeficit} deficit`;
    const redundancyMessage = `${result.liquidityRedundancy} redundancy`;

    console.log(
      `Executing liquidity management rule ${rule.id}. Verification result -> ${
        result.liquidityDeficit ? deficitMessage : redundancyMessage
      } of ${rule.target.name}`,
    );
  }
}
