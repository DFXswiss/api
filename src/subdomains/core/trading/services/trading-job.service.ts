import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { TradingOrderService } from './trading-order.service';
import { TradingRuleService } from './trading-rule.service';

@Injectable()
export class TradingJobService {
  constructor(private readonly ruleService: TradingRuleService, private readonly orderService: TradingOrderService) {}

  // --- RULES --- //

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async processRules() {
    if (DisabledProcess(Process.TRADING)) return;

    await this.ruleService.processRules();
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  @Lock(1800)
  async reactivateRules(): Promise<void> {
    if (DisabledProcess(Process.TRADING)) return;

    await this.ruleService.reactivateRules();
  }

  // --- ORDERS --- //

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async processOrders() {
    if (DisabledProcess(Process.TRADING)) return;

    await this.orderService.processOrders();
  }
}
