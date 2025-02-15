import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { TradingOrderService } from './trading-order.service';
import { TradingRuleService } from './trading-rule.service';

@Injectable()
export class TradingJobService {
  constructor(private readonly ruleService: TradingRuleService, private readonly orderService: TradingOrderService) {}

  // --- RULES --- //

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.TRADING, timeout: 1800 })
  async processRules() {
    await this.ruleService.processRules();
  }

  @DfxCron(CronExpression.EVERY_5_MINUTES, { process: Process.TRADING, timeout: 1800 })
  async reactivateRules(): Promise<void> {
    await this.ruleService.reactivateRules();
  }

  // --- ORDERS --- //

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.TRADING, timeout: 1800 })
  async processOrders() {
    await this.orderService.processOrders();
  }
}
