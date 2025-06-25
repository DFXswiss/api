import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { In, Not } from 'typeorm';
import { LiquidityBalance } from '../entities/liquidity-balance.entity';
import { LiquidityManagementPipeline } from '../entities/liquidity-management-pipeline.entity';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';
import { LiquidityManagementPipelineStatus, LiquidityManagementRuleStatus, LiquidityOptimizationType } from '../enums';
import { LiquidityState } from '../interfaces';
import { LiquidityManagementPipelineRepository } from '../repositories/liquidity-management-pipeline.repository';
import { LiquidityManagementRuleRepository } from '../repositories/liquidity-management-rule.repository';
import { LiquidityManagementBalanceService } from './liquidity-management-balance.service';

@Injectable()
export class LiquidityManagementService {
  private readonly logger: DfxLogger;
  private readonly ruleActivations = new Map<number, Date>();

  constructor(
    private readonly ruleRepo: LiquidityManagementRuleRepository,
    private readonly pipelineRepo: LiquidityManagementPipelineRepository,
    private readonly balanceService: LiquidityManagementBalanceService,
    private readonly settingService: SettingService,
    readonly loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(LiquidityManagementService);
  }

  //*** JOBS ***//

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.LIQUIDITY_MANAGEMENT, timeout: 1800 })
  async verifyRules() {
    const rules = await this.ruleRepo.findBy({ status: Not(LiquidityManagementRuleStatus.DISABLED) });
    const balances = await this.balanceService.refreshBalances(rules);

    for (const rule of rules) {
      await this.verifyRule(rule, balances);
    }
  }

  //*** PUBLIC API ***//

  async buyLiquidity(
    assetId: number,
    minAmount: number,
    maxAmount: number,
    targetOptimal: boolean,
  ): Promise<LiquidityManagementPipeline> {
    const rule = await this.findRuleByAssetOrThrow(assetId);

    if (!rule.deficitStartAction) {
      throw new BadRequestException(`Rule ${rule.id} does not support liquidity deficit path`);
    }

    if (targetOptimal) maxAmount = Util.round(maxAmount + rule.optimal, 6);

    const liquidityState: LiquidityState = {
      action: LiquidityOptimizationType.DEFICIT,
      minAmount,
      maxAmount,
    };

    return this.executeRule(rule, liquidityState, LiquidityOptimizationType.DEFICIT);
  }

  async sellLiquidity(
    assetId: number,
    minAmount: number,
    maxAmount: number,
    targetOptimal: boolean,
  ): Promise<LiquidityManagementPipeline> {
    const rule = await this.findRuleByAssetOrThrow(assetId);

    if (!rule.redundancyStartAction) {
      throw new BadRequestException(`Rule ${rule.id} does not support liquidity redundancy path`);
    }

    if (targetOptimal) maxAmount = Util.round(maxAmount - rule.optimal, 6);

    const liquidityState: LiquidityState = {
      action: LiquidityOptimizationType.REDUNDANCY,
      minAmount,
      maxAmount,
    };

    return this.executeRule(rule, liquidityState, LiquidityOptimizationType.REDUNDANCY);
  }

  //*** HELPER METHODS ***//

  private async findRuleByAssetOrThrow(assetId: number): Promise<LiquidityManagementRule> {
    const rule = await this.ruleRepo.findOneBy({ targetAsset: { id: assetId } });

    if (!rule) throw new NotFoundException(`No liquidity management rule found for asset ${assetId}`);

    return rule;
  }

  private async verifyRule(rule: LiquidityManagementRule, balances: LiquidityBalance[]): Promise<void> {
    try {
      if (rule.status !== LiquidityManagementRuleStatus.ACTIVE) {
        this.logger.info(`Could not verify rule ${rule.id}: status is ${rule.status}`);
        return;
      }

      const numberOfPendingOrders = await this.balanceService.getNumberOfPendingOrders(rule);
      if (numberOfPendingOrders > 0) {
        this.logger.info(`Could not verify rule ${rule.id}: pending orders found`);
        return;
      }

      const balance = this.balanceService.findRelevantBalance(rule, balances);
      if (!balance) {
        this.logger.info(`Could not verify rule ${rule.id}: balance not found`);
        return;
      }

      const result = rule.verify(balance);

      if (result.action) {
        if (!this.ruleActivations.has(rule.id)) {
          this.ruleActivations.set(rule.id, new Date());
          this.logger.info(
            `Rule ${rule.id} activated: ${result.maxAmount} (min. ${result.minAmount}) ${result.action.toLowerCase()}`,
          );
        }

        // execute rule with delay
        const delay = await this.settingService.get('lmActivationDelay', '30');
        const requiredActivationTime = Util.minutesBefore(+delay);

        if (this.ruleActivations.get(rule.id) < requiredActivationTime) {
          this.ruleActivations.delete(rule.id);

          await this.executeRule(rule, result);
        }
      } else {
        this.ruleActivations.delete(rule.id);
      }
    } catch (e) {
      if (e instanceof ConflictException) return;

      this.logger.error(`Error in verifying the liquidity management rule ${rule.id}:`, e);
    }
  }

  private async executeRule(
    rule: LiquidityManagementRule,
    result: LiquidityState,
    pipelineType?: LiquidityOptimizationType,
  ): Promise<LiquidityManagementPipeline> {
    const pipeline = await this.findRunningPipeline(rule, pipelineType);
    if (pipeline) return pipeline;

    if (rule.status !== LiquidityManagementRuleStatus.ACTIVE) {
      throw new ConflictException(`Pipeline for rule ${rule.id} cannot be started (status ${rule.status})`);
    }

    this.logRuleExecution(rule, result);

    const newPipeline = LiquidityManagementPipeline.create(rule, result);
    const savedPipeline = await this.pipelineRepo.save(newPipeline);

    rule.processing();
    await this.ruleRepo.save(rule);

    return savedPipeline;
  }

  private findRunningPipeline(
    rule: LiquidityManagementRule,
    type?: LiquidityOptimizationType,
  ): Promise<LiquidityManagementPipeline | undefined> {
    return this.pipelineRepo.findOneBy({
      rule: { id: rule.id },
      status: In([LiquidityManagementPipelineStatus.CREATED, LiquidityManagementPipelineStatus.IN_PROGRESS]),
      type,
    });
  }

  private logRuleExecution(rule: LiquidityManagementRule, result: LiquidityState): void {
    this.logger.verbose(
      `Executing liquidity management rule ${rule.id} with ${result.action.toLowerCase()} of ${
        result.maxAmount
      } (min. ${result.minAmount}) ${rule.targetName})`,
    );
  }
}
