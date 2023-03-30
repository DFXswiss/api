import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Lock } from 'src/shared/utils/lock';
import { LiquidityBalance } from '../entities/liquidity-balance.entity';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';
import { LiquidityManagementPipelineStatus, LiquidityManagementRuleStatus } from '../enums';
import { LiquidityState, PipelineId } from '../interfaces';
import { LiquidityManagementRuleRepository } from '../repositories/liquidity-management-rule.repository';
import { LiquidityManagementBalanceService } from './liquidity-management-balance.service';
import { LiquidityManagementPipelineRepository } from '../repositories/liquidity-management-pipeline.repository';
import { LiquidityManagementPipeline } from '../entities/liquidity-management-pipeline.entity';
import { In } from 'typeorm';

@Injectable()
export class LiquidityManagementService {
  constructor(
    private readonly ruleRepo: LiquidityManagementRuleRepository,
    private readonly pipelineRepo: LiquidityManagementPipelineRepository,
    private readonly balanceService: LiquidityManagementBalanceService,
  ) {}

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async verifyRules() {
    const rules = await this.ruleRepo.findBy({ status: LiquidityManagementRuleStatus.ACTIVE });
    const balances = await this.balanceService.refreshBalances(rules);

    for (const rule of rules) {
      await this.verifyRule(rule, balances);
    }
  }

  //*** PUBLIC API ***//

  async buyLiquidity(assetId: number, amount: number): Promise<PipelineId> {
    const rule = await this.findRuleByAssetOrThrow(assetId);

    if (!rule.deficitStartAction) {
      throw new BadRequestException(`Rule ${rule.id} does not support liquidity deficit path`);
    }

    const liquidityState = { deficit: amount, redundancy: 0 };

    return this.executeRule(rule, liquidityState);
  }

  async sellLiquidity(assetId: number, amount: number): Promise<PipelineId> {
    const rule = await this.findRuleByAssetOrThrow(assetId);

    if (!rule.redundancyStartAction) {
      throw new BadRequestException(`Rule ${rule.id} does not support liquidity redundancy path`);
    }

    const liquidityState = { deficit: 0, redundancy: amount };

    return this.executeRule(rule, liquidityState);
  }

  //*** HELPER METHODS ***//

  private async findRuleByAssetOrThrow(assetId: number): Promise<LiquidityManagementRule> {
    const rule = await this.ruleRepo.findOneBy({ targetAsset: { id: assetId } });

    if (!rule) throw new NotFoundException(`No liquidity management rule found for asset ${assetId}`);

    return rule;
  }

  private async verifyRule(rule: LiquidityManagementRule, balances: LiquidityBalance[]): Promise<void> {
    try {
      const balance = this.balanceService.findRelevantBalance(rule, balances);

      if (!balance) throw new Error('Could not proceed with rule verification, balance not found.');

      const result = rule.verify(balance);

      if (result.deficit || result.redundancy) {
        await this.executeRule(rule, result);
      }
    } catch (e) {
      if (e instanceof ConflictException) return;

      console.error(`Error in verifying the liquidity management rule id: ${rule.id}`, e);
    }
  }

  private async executeRule(rule: LiquidityManagementRule, result: LiquidityState): Promise<PipelineId> {
    if (await this.findExistingPipeline(rule)) {
      throw new ConflictException(`Pipeline for the rule ${rule.id} is already running.`);
    }

    this.logRuleExecution(rule, result);

    const newPipeline = LiquidityManagementPipeline.create(rule, result);
    const savedPipeline = await this.pipelineRepo.save(newPipeline);

    rule.processing();
    await this.ruleRepo.save(rule);

    return savedPipeline.id;
  }

  private findExistingPipeline(rule: LiquidityManagementRule): Promise<LiquidityManagementPipeline | undefined> {
    return this.pipelineRepo.findOneBy({
      rule: { id: rule.id },
      status: In([LiquidityManagementPipelineStatus.CREATED, LiquidityManagementPipelineStatus.IN_PROGRESS]),
    });
  }

  private logRuleExecution(rule: LiquidityManagementRule, result: LiquidityState): void {
    const deficitMessage = `${result.deficit} deficit`;
    const redundancyMessage = `${result.redundancy} redundancy`;

    console.log(
      `Executing liquidity management rule ${rule.id}. Summary -> ${
        result.deficit ? deficitMessage : redundancyMessage
      } of ${rule.target.name}`,
    );
  }
}
