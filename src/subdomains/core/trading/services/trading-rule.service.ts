import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { In, IsNull, Not } from 'typeorm';
import { UpdateTradingRuleDto } from '../dto/update-trading-rule.dto';
import { TradingOrder } from '../entities/trading-order.entity';
import { TradingRule } from '../entities/trading-rule.entity';
import { TradingRuleStatus } from '../enums';
import { TradingOrderRepository } from '../repositories/trading-order.respository';
import { TradingRuleRepository } from '../repositories/trading-rule.respository';
import { TradingService } from './trading.service';

@Injectable()
export class TradingRuleService {
  private readonly logger = new DfxLogger(TradingRuleService);

  @Inject() private readonly ruleRepo: TradingRuleRepository;
  @Inject() private readonly orderRepo: TradingOrderRepository;

  constructor(private readonly tradingService: TradingService) {}

  // --- PUBLIC API --- //

  async getCurrentTradingOrders(): Promise<TradingOrder[]> {
    const lastTradingOrderIds = await this.orderRepo
      .createQueryBuilder('tradingOrder')
      .select('MAX(tradingOrder.id)', 'tradingOrderId')
      .innerJoin('tradingOrder.tradingRule', 'tradingRule')
      .groupBy('tradingOrder.tradingRuleId')
      .getRawMany<{ tradingOrderId: number }>()
      .then((t) => t.map((t) => t.tradingOrderId));

    return this.orderRepo.findBy({ id: In(lastTradingOrderIds) });
  }

  async updateTradingRule(id: number, dto: UpdateTradingRuleDto): Promise<void> {
    const tradingRule = await this.ruleRepo.findOneBy({ id });
    if (!tradingRule) throw new NotFoundException('Trading rule not found');

    await this.ruleRepo.update(tradingRule.id, dto);
  }

  async processRules() {
    const rules = await this.ruleRepo.findBy({
      status: In([TradingRuleStatus.ACTIVE, TradingRuleStatus.PROCESSING, TradingRuleStatus.PAUSED]),
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
      if (rule.leftAsset.blockchain !== rule.rightAsset.blockchain) {
        rule.deactivate();
        await this.ruleRepo.save(rule);

        throw new Error(`Blockchain mismatch in trading rule ${rule.id}`);
      }

      const tradingInfo = await this.tradingService.createTradingInfo(rule);

      if (tradingInfo) {
        if (rule.status !== TradingRuleStatus.ACTIVE) {
          tradingInfo.tradeRequired = false;
          tradingInfo.message = `Rule is ${rule.status.toLowerCase()}`;
        }

        if (tradingInfo.tradeRequired) {
          rule.processing();
          await this.ruleRepo.save(rule);
        }

        const order = TradingOrder.create(rule, tradingInfo);
        await this.orderRepo.save(order);
      }
    } catch (e) {
      this.logger.error(`Error processing trading rule ${rule.id}:`, e);
    }
  }
}
