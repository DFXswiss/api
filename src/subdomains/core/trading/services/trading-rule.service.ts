import { Inject, Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { IsNull, Not } from 'typeorm';
import { TradingOrder } from '../entities/trading-order.entity';
import { TradingRule } from '../entities/trading-rule.entity';
import { TradingRuleStatus } from '../enums';
import { TradingOrderRepository } from '../repositories/trading-order.respoitory';
import { TradingRuleRepository } from '../repositories/trading-rule.respoitory';
import { TradingService } from './trading.service';

@Injectable()
export class TradingRuleService {
  private readonly logger = new DfxLogger(TradingRuleService);

  @Inject() private readonly ruleRepo: TradingRuleRepository;
  @Inject() private readonly orderRepo: TradingOrderRepository;

  constructor(private readonly tradingService: TradingService) {}

  // --- PUBLIC API --- //

  async processRules() {
    const rules = await this.ruleRepo.findBy({
      status: TradingRuleStatus.ACTIVE,
    });

    for (const rule of rules) {
      await this.executeRule(rule);
    }
  }

  async reactivateRules(): Promise<void> {
    const rules = await this.ruleRepo.findBy({
      status: TradingRuleStatus.PAUSED,
      reactivationTime: Not(IsNull()),
    });

    for (const rule of rules) {
      if (rule.shouldReactivate()) {
        rule.reactivate();
        await this.ruleRepo.save(rule);
        this.logger.info(`Reactivated trading rule ${rule.id}`);
      }
    }
  }

  // --- HELPER METHODS --- //

  private async executeRule(rule: TradingRule): Promise<void> {
    try {
      if (!rule.isActive()) {
        const message = `Could not execute rule ${rule.id}: status is ${rule.status}`;
        this.logger.info(message);
        return;
      }

      const leftAsset = rule.leftAsset;
      const rightAsset = rule.rightAsset;

      leftAsset.blockchain === rightAsset.blockchain ? rule.processing() : rule.deactivate();
      await this.ruleRepo.save(rule);

      if (!rule.isProcessing()) {
        throw new Error(
          `Blockchain mismatch: ${leftAsset.blockchain} and ${rightAsset.blockchain} in trading rule ${rule.id}`,
        );
      }

      const tradingInfo = await this.tradingService.createTradingInfo(rule);

      if (tradingInfo.amountIn) {
        const order = TradingOrder.create(rule, tradingInfo);

        await this.orderRepo.save(order);
      }
    } catch (e) {
      const message = `Error processing trading rule ${rule.id}`;
      this.logger.error(message, e);
    }
  }
}
