import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { In, LessThan } from 'typeorm';
import { TradingOrderStatus } from '../../trading/enums';

interface LiquidityData {
  stuckTradingOrderCount: number;
}

@Injectable()
export class LiquidityObserver extends MetricObserver<LiquidityData> {
  protected readonly logger = new DfxLogger(LiquidityObserver);

  constructor(monitoringService: MonitoringService, private readonly repos: RepositoryFactory) {
    super(monitoringService, 'liquidity', 'trading');
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.MONITORING, timeout: 1800 })
  async fetch() {
    const data = await this.getTradingData();

    this.emit(data);

    return data;
  }

  // --- HELPER METHODS --- //

  private async getTradingData(): Promise<LiquidityData> {
    return {
      stuckTradingOrderCount: await this.repos.tradingOrder.countBy({
        status: In([TradingOrderStatus.CREATED, TradingOrderStatus.IN_PROGRESS]),
        created: LessThan(Util.minutesBefore(15)),
      }),
    };
  }
}
