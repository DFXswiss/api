import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ExchangeTxType } from 'src/integration/exchange/entities/exchange-tx.entity';
import { ExchangeName } from 'src/integration/exchange/enums/exchange.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { MoreThan } from 'typeorm';

interface ExchangeData {
  name: string;
  volume30: number; //volume of the last 30 days
}

@Injectable()
export class ExchangeObserver extends MetricObserver<ExchangeData[]> {
  protected readonly logger: DfxLogger;

  constructor(
    monitoringService: MonitoringService,
    readonly loggerFactory: LoggerFactory,
    private readonly repos: RepositoryFactory,
  ) {
    super(monitoringService, 'exchange', 'volume');

    this.logger = this.loggerFactory.create(ExchangeObserver);
  }

  @DfxCron(CronExpression.EVERY_10_MINUTES, { process: Process.MONITORING, timeout: 1800 })
  async fetch() {
    if (DisabledProcess(Process.MONITORING)) return;

    const data = [];
    data.push(await this.getKraken());
    data.push(await this.getBinance());
    this.emit(data);

    return data;
  }

  // *** HELPER METHODS *** //

  private async getKraken(): Promise<ExchangeData> {
    const volume30 = await this.getVolume30(ExchangeName.KRAKEN);
    return {
      name: 'Kraken',
      volume30,
    };
  }

  private async getBinance(): Promise<ExchangeData> {
    const volume30 = await this.getVolume30(ExchangeName.BINANCE);
    return {
      name: 'Binance',
      volume30,
    };
  }

  private async getVolume30(exchange: ExchangeName): Promise<number> {
    return this.repos.exchangeTx.sum('amountChf', {
      exchange,
      type: ExchangeTxType.TRADE,
      created: MoreThan(Util.daysBefore(30)),
    });
  }
}
