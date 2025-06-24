import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { Process, ProcessService } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { In, LessThan } from 'typeorm';
import { TradingOrderStatus, TradingRuleStatus } from '../../trading/enums';

interface LiquidityData {
  stuckTradingOrderCount: number;
  stuckTradingRuleCount: number;
  stuckLiquidityOrderCount: number;
  safetyModeActive: boolean;
}

@Injectable()
export class LiquidityObserver extends MetricObserver<LiquidityData> {
  protected readonly logger: DfxLoggerService;

  constructor(
    monitoringService: MonitoringService,
    private readonly repos: RepositoryFactory,
    private readonly processService: ProcessService,
    private readonly dfxLogger: DfxLoggerService,
  ) {
    super(monitoringService, 'liquidity', 'trading');

    this.logger = this.dfxLogger.create(LiquidityObserver);
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.MONITORING, timeout: 1800 })
  async fetch() {
    const data = await this.getLiquidityData();

    this.emit(data);

    return data;
  }

  // --- HELPER METHODS --- //

  private async getLiquidityData(): Promise<LiquidityData> {
    return {
      stuckTradingOrderCount: await this.repos.tradingOrder.countBy({
        status: In([TradingOrderStatus.CREATED, TradingOrderStatus.IN_PROGRESS]),
        created: LessThan(Util.minutesBefore(15)),
      }),
      stuckTradingRuleCount: await this.repos.tradingRule.countBy({
        status: In([TradingRuleStatus.PAUSED, TradingRuleStatus.PROCESSING]),
        updated: LessThan(Util.minutesBefore(30)),
      }),
      stuckLiquidityOrderCount: await this.repos.liquidityOrder.countBy({
        isComplete: false,
        updated: LessThan(Util.minutesBefore(30)),
      }),
      safetyModeActive: this.processService.isSafetyModeActive(),
    };
  }
}
