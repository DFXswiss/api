import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DfxLogger, LogLevel } from 'src/shared/services/dfx-logger';
import { In, IsNull, Not } from 'typeorm';
import { PriceUnavailableException } from '../../../supporting/pricing/domain/exceptions/price-unavailable.exception';
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
    // Per-rule MAX(id) lookups (not one table-wide aggregate) so Postgres can use the composite
    // index on trading_order ("tradingRuleId", "id"). Must ship with that index — without it this
    // shape is ~9× slower than the previous GROUP BY scan (see AddTradingOrderRuleIdIndex).
    const rules = await this.ruleRepo.find({ select: { id: true } });

    const maxIdRows = await Promise.all(
      rules.map((rule) =>
        this.orderRepo
          .createQueryBuilder('tradingOrder')
          .select('MAX(tradingOrder.id)', 'tradingOrderId')
          .where('tradingOrder.tradingRuleId = :ruleId', { ruleId: rule.id })
          .getRawOne<{ tradingOrderId: number | null }>(),
      ),
    );

    const lastTradingOrderIds = maxIdRows
      .map((row) => row?.tradingOrderId)
      .filter((id): id is number => id !== null && id !== undefined);

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
      // Price-source unavailability is already logged at the provider and heals on a later
      // cycle - only unexpected failures stay at error.
      // Specific PriceUnavailableException classification only — a blanket isConnectionFailure(e)
      // check here would risk downgrading a genuine DB/repository failure (e.g. ruleRepo.save /
      // orderRepo.save) to warn, the same bug class this fix removes from the pricing layer.
      const logLevel = e instanceof PriceUnavailableException ? LogLevel.WARN : LogLevel.ERROR;

      this.logger.log(logLevel, `Error processing trading rule ${rule.id}:`, e);
    }
  }
}
