import { Inject, Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { TradingOrderRepository } from '../repositories/trading-order.respoitory';
import { TradingRuleRepository } from '../repositories/trading-rule.respoitory';
import { TradingOrderService } from './trading-order.service';
import { TradingRuleService } from './trading-rule.service';

@Injectable()
export class TradingJobService {
  private readonly logger = new DfxLogger(TradingJobService);

  @Inject() private readonly ruleRepo: TradingRuleRepository;
  @Inject() private readonly orderRepo: TradingOrderRepository;

  constructor(private readonly ruleService: TradingRuleService, private readonly orderService: TradingOrderService) {}

  // --- RULES --- //

  //@Cron(CronExpression.EVERY_MINUTE)
  //@Lock(1800)
  async processRules() {
    //if (DisabledProcess(Process.TRADING)) return;
    console.log('Trading Rule: processRules()');
    await this.ruleService.processRules();
  }

  //  @Cron(CronExpression.EVERY_5_MINUTES)
  //  @Lock(1800)
  async reactivateRules(): Promise<void> {
    await this.ruleService.reactivateRules();
  }

  // --- ORDERS --- //

  //@Cron(CronExpression.EVERY_MINUTE)
  //@Lock(1800)
  async processOrders() {
    //  if (DisabledProcess(Process.MARKET_MAKING)) return;
    await this.orderService.processOrders();
  }
}
