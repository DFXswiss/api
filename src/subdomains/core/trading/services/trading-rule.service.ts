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

  // One statement, not a per-rule loop: all rules' latest orders must come from the same
  // READ-COMMITTED snapshot, because LogJobService writes the FinanceLog from this result.
  // Separate statements per rule could observe an insert into trading_order mid-loop and mix
  // rows from different points in time. A LATERAL keeps that property — still one statement,
  // one snapshot — while removing the aggregate's whole-index read.
  //
  // `MAX(id) GROUP BY tradingRuleId` has to walk the composite index on
  // trading_order ("tradingRuleId", "id") end to end, because PostgreSQL has no skip scan: its
  // cost grows with the number of orders, which is unbounded. Driven from trading_rule instead,
  // each rule is one backward index scan stopped at the first row, so the cost grows with the
  // number of rules — configuration, and small. DFXServer/server#1223 measured the aggregate at
  // roughly 0.5 s a run, 20 runs over 100 ms within 75 minutes, with that index already in place.
  //
  // Raw SQL because LATERAL has no query-builder equivalent. The set semantics are the ones the
  // INNER JOIN gave: driving from trading_rule drops orders whose rule no longer exists, and a
  // rule with no orders contributes nothing because its lateral subquery returns no row.
  //
  // pg-mem cannot execute this — it does not resolve the outer reference — which is why the spec
  // for this method runs against a real PostgreSQL behind MIGRATION_TEST_PG.
  async getCurrentTradingOrders(): Promise<TradingOrder[]> {
    const rows: { tradingOrderId: number }[] = await this.orderRepo.manager.query(`
      SELECT latest."id" AS "tradingOrderId"
      FROM "trading_rule" rule
      CROSS JOIN LATERAL (
        SELECT "order"."id"
        FROM "trading_order" "order"
        WHERE "order"."tradingRuleId" = rule."id"
        ORDER BY "order"."id" DESC
        LIMIT 1
      ) latest
    `);

    return this.orderRepo.findBy({ id: In(rows.map((row) => row.tradingOrderId)) });
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
