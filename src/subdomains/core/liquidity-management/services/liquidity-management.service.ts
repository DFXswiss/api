import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import {
  PriceCurrency,
  PriceValidity,
  PricingService,
} from 'src/subdomains/supporting/pricing/services/pricing.service';
import { In, Not } from 'typeorm';
import { LiquidityBalance } from '../entities/liquidity-balance.entity';
import { LiquidityManagementPipeline } from '../entities/liquidity-management-pipeline.entity';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';
import { LiquidityManagementPipelineStatus, LiquidityManagementRuleStatus, LiquidityOptimizationType } from '../enums';
import { LiquidityState, PayoutDemand } from '../interfaces';
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
    private readonly pricingService: PricingService,
    private readonly assetService: AssetService,
    @Inject(forwardRef(() => BuyCryptoService))
    private readonly buyCryptoService: BuyCryptoService,
    private readonly payoutService: PayoutService,
  ) {}

  //*** JOBS ***//

  @DfxCron(CronExpression.EVERY_MINUTE, {
    scope: CronScope.WORKER,
    process: Process.LIQUIDITY_MANAGEMENT_CHECK_BALANCES,
    timeout: 1800,
  })
  async checkLiquidityBalances() {
    const rules = await this.ruleRepo.findBy({ status: Not(LiquidityManagementRuleStatus.DISABLED) });
    const balances = await this.balanceService.refreshBalances(rules);

    if (DisabledProcess(Process.LIQUIDITY_MANAGEMENT)) return;

    for (const rule of rules) {
      if (rule.status === LiquidityManagementRuleStatus.INACTIVE) continue;
      await this.verifyRule(rule, balances);
    }
  }

  //*** PUBLIC API ***//

  async getPipelineWithOrders(pipelineId: number): Promise<LiquidityManagementPipeline | null> {
    return this.pipelineRepo.findOne({
      where: { id: pipelineId },
      relations: { orders: true },
    });
  }

  async buyLiquidity(
    assetId: number,
    minAmount: number,
    maxAmount: number,
    targetOptimal: boolean,
  ): Promise<LiquidityManagementPipeline> {
    const rule = await this.findRuleByAssetOrThrow(assetId);

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

    if (targetOptimal) maxAmount = Util.round(maxAmount - rule.optimal, 6);

    const liquidityState: LiquidityState = {
      action: LiquidityOptimizationType.REDUNDANCY,
      minAmount,
      maxAmount,
    };

    return this.executeRule(rule, liquidityState, LiquidityOptimizationType.REDUNDANCY);
  }

  // Clears the activation-debounce timer for a rule. Called when a rule leaves the drain lifecycle
  // (e.g. paused after a failed pipeline) so that a subsequent reactivation re-debounces from scratch.
  resetActivation(ruleId: number): void {
    this.ruleActivations.delete(ruleId);
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

      const balance = this.balanceService.findRelevantBalance(rule, balances);
      if (!balance) {
        this.logger.info(`Could not verify rule ${rule.id}: balance not found`);
        return;
      }

      const eurPrice = await this.pricingService.getPrice(PriceCurrency.EUR, rule.targetAsset, PriceValidity.ANY);
      const transmissionMinimum = eurPrice.convert(Config.liquidityManagement.fiatOutput.batchAmountLimit * 0.95, 8);

      const result = rule.verify(balance, transmissionMinimum);

      if (result.action) {
        const hasPendingOrders = await this.balanceService.hasPendingOrders(rule);
        if (hasPendingOrders) {
          this.logger.info(`Could not verify rule ${rule.id}: pending orders found`);
          return;
        }

        // the entry survives a completed pipeline on purpose (handlePipelineCompletion does not reset it), and
        // that is load-bearing for deliveries a venue only accepts in installments: installments 2..n keep the
        // activation time of the first one and therefore run without waiting out the delay again
        if (!this.ruleActivations.has(rule.id)) {
          this.ruleActivations.set(rule.id, new Date());
          this.logger.info(
            `Rule ${rule.id} activated: ${result.maxAmount} (min. ${result.minAmount}) ${result.action.toLowerCase()}`,
          );
        }

        // execute rule with delay
        const delay = await this.settingService.get('lmActivationDelay', '30');
        const requiredActivationTime = Util.minutesBefore(+delay);

        if (!rule.delayActivation || this.ruleActivations.get(rule.id) < requiredActivationTime) {
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

    if (!rule.hasStartAction(result.action)) {
      throw new BadRequestException(`Rule ${rule.id} does not support ${result.action.toLowerCase()} path`);
    }

    await this.checkPayoutDemand(rule, result.action);

    this.logRuleExecution(rule, result);

    const newPipeline = LiquidityManagementPipeline.create(rule, result);
    const savedPipeline = await this.pipelineRepo.save(newPipeline);

    rule.processing();
    await this.ruleRepo.save(rule);

    return savedPipeline;
  }

  /**
   * A coin with payouts still owed must not be sold, wherever that coin happens to sit.
   *
   * The sale a rule calls redundancy is decided from one balance against that rule's own `maximal`,
   * and the customers waiting for the coin do not enter that comparison at all. That is how the
   * deficit path and the redundancy path of the same coin came to work against each other: the
   * deficit path bought the coin at a venue for a transaction that was waiting, the delivery to the
   * payout wallet failed, and the purchase — still sitting at the venue, now above `maximal` —
   * read as surplus and was sold straight back, while the customer went on waiting and the payout
   * wallet went on being short. It repeated on the next cycle, and would on any failure between
   * buying a coin and delivering it. Every repetition pays the spread and the fees twice.
   *
   * Deliberately redundancy-only. The deficit path is what SERVES the waiting demand; blocking it
   * on the same condition would leave the demand permanently unmet — and permanently blocking.
   *
   * Sits after the running-pipeline and status guards so it costs a query only where a sale would
   * otherwise start, and throws the same `ConflictException` those guards throw: the cron path
   * treats it as "not this minute" and retries on the next one, while the manual sell endpoint
   * answers 409 naming the coin that is holding it up.
   */
  private async checkPayoutDemand(rule: LiquidityManagementRule, action: LiquidityOptimizationType): Promise<void> {
    if (action !== LiquidityOptimizationType.REDUNDANCY) return;

    const demand = await this.getPayoutDemand(rule);
    if (!demand) return;

    this.logger.info(
      `Withholding ${rule.targetName} sale of rule ${rule.id}: ${demand.transactions} transaction(s) and ${
        demand.orders
      } payout order(s) are waiting for ${demand.coin} (${demand.assets.join(', ')})`,
    );

    throw new ConflictException(
      `Pipeline for rule ${rule.id} cannot be started: payouts of ${demand.coin} are waiting`,
    );
  }

  private async getPayoutDemand(rule: LiquidityManagementRule): Promise<PayoutDemand | undefined> {
    // a rule holding fiat has no crypto payout to compete with
    if (!rule.targetAsset) return undefined;

    const assets = await this.assetService.getSameCoinAssets(rule.targetAsset);
    const assetIds = assets.map((a) => a.id);

    const [transactions, orders] = await Promise.all([
      this.buyCryptoService.countAwaitingPayout(assetIds),
      this.payoutService.countPendingPayouts(assetIds),
    ]);

    if (!transactions && !orders) return undefined;

    return {
      coin: rule.targetAsset.name,
      assets: assets.map((a) => a.uniqueName),
      transactions,
      orders,
    };
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
