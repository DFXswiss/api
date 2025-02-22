import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { In, Not } from 'typeorm';
import { LiquidityBalance } from '../entities/liquidity-balance.entity';
import { LiquidityManagementPipeline } from '../entities/liquidity-management-pipeline.entity';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';
import { LiquidityManagementPipelineStatus, LiquidityManagementRuleStatus } from '../enums';
import { LiquidityState, PipelineId } from '../interfaces';
import { LiquidityManagementPipelineRepository } from '../repositories/liquidity-management-pipeline.repository';
import { LiquidityManagementRuleRepository } from '../repositories/liquidity-management-rule.repository';
import { LiquidityManagementBalanceService } from './liquidity-management-balance.service';

@Injectable()
export class LiquidityManagementService {
  private readonly logger = new DfxLogger(LiquidityManagementService);

  private readonly ruleActivations = new Map<number, Date>();

  constructor(
    private readonly ruleRepo: LiquidityManagementRuleRepository,
    private readonly pipelineRepo: LiquidityManagementPipelineRepository,
    private readonly balanceService: LiquidityManagementBalanceService,
    private readonly settingService: SettingService,
  ) {}

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

  async buyLiquidity(assetId: number, amount: number, targetOptimal: boolean): Promise<PipelineId> {
    const rule = await this.findRuleByAssetOrThrow(assetId);

    if (!rule.deficitStartAction) {
      throw new BadRequestException(`Rule ${rule.id} does not support liquidity deficit path`);
    }

    if (targetOptimal) amount = Util.round(amount + rule.optimal, 6);

    const liquidityState = { deficit: amount, redundancy: 0 };

    return this.executeRule(rule, liquidityState);
  }

  async sellLiquidity(assetId: number, amount: number, targetOptimal: boolean): Promise<PipelineId> {
    const rule = await this.findRuleByAssetOrThrow(assetId);

    if (!rule.redundancyStartAction) {
      throw new BadRequestException(`Rule ${rule.id} does not support liquidity redundancy path`);
    }

    if (targetOptimal) amount = Util.round(amount - rule.optimal, 6);

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

      if (result.deficit || result.redundancy) {
        if (!this.ruleActivations.has(rule.id)) {
          this.ruleActivations.set(rule.id, new Date());
          this.logger.info(`Rule ${rule.id} activated: ${result.deficit} deficit, ${result.redundancy} redundancy`);
        }

        // execute rule 30 minutes after activation
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

  private async executeRule(rule: LiquidityManagementRule, result: LiquidityState): Promise<PipelineId> {
    if (rule.status !== LiquidityManagementRuleStatus.ACTIVE || (await this.findExistingPipeline(rule))) {
      throw new ConflictException(`Pipeline for rule ${rule.id} cannot be started (status ${rule.status})`);
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
    const message = result.deficit ? `${result.deficit} deficit` : `${result.redundancy} redundancy`;

    this.logger.verbose(`Executing liquidity management rule ${rule.id} (${message} of ${rule.targetName})`);
  }
}
