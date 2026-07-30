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

  // One statement, not a per-rule loop: all rules' maxima must come from the same
  // READ-COMMITTED snapshot, because LogJobService writes the FinanceLog from this result.
  // Separate statements per rule could observe an insert into trading_order mid-loop and mix
  // maxima from different points in time — a single GROUP BY aggregate cannot do that.
  // The composite index on trading_order ("tradingRuleId", "id") (see the
  // AddTradingOrderRuleIdIndex migration) lets Postgres answer this with an Index Only Scan.
  // A correlated per-rule lookup would be faster still, but pg-mem (this repo's test engine for
  // this query, see trading-rule.service.pg.spec.ts) cannot execute a correlated subquery —
  // don't "optimize" this into one without first solving that.
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
