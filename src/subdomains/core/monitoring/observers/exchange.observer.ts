import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ExchangeTxType } from 'src/integration/exchange/entities/exchange-tx.entity';
import { ExchangeName } from 'src/integration/exchange/enums/exchange.enum';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';

interface ExchangeData {
  name: string;
  volume30: number;
}

@Injectable()
export class ExchangeObserver extends MetricObserver<ExchangeData[]> {
  protected readonly logger = new DfxLogger(ExchangeObserver);

  constructor(monitoringService: MonitoringService, private readonly repos: RepositoryFactory) {
    super(monitoringService, 'exchange', 'volume');
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  @Lock(1800)
  async fetch() {
    if (DisabledProcess(Process.MONITORING)) return;

    const data = [];
    data.concat(await this.getKraken());
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

  private async getVolume30(exchange: ExchangeName): Promise<number> {
    return this.repos.exchangeTx.sum('vol', { exchange, type: ExchangeTxType.TRADE });
  }
}
