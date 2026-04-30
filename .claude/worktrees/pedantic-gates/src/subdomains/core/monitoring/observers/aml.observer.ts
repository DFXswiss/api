import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { IsNull } from 'typeorm';
import { CheckStatus } from '../../aml/enums/check-status.enum';

interface AmlData {
  buyCrypto: AmlDetails;
  buyFiat: AmlDetails;
}

interface AmlDetails {
  pending: number;
  gs: number;
  withoutCheck: number;
}

@Injectable()
export class AmlObserver extends MetricObserver<AmlData> {
  protected readonly logger = new DfxLogger(AmlObserver);

  constructor(
    monitoringService: MonitoringService,
    private readonly repos: RepositoryFactory,
  ) {
    super(monitoringService, 'payment', 'aml');
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.MONITORING, timeout: 1800 })
  async fetch() {
    const data = await this.getAmlData();

    this.emit(data);

    return data;
  }

  // *** HELPER METHODS *** //

  private async getAmlData(): Promise<AmlData> {
    return {
      buyCrypto: {
        pending: await this.repos.buyCrypto.countBy({
          amlCheck: CheckStatus.PENDING,
        }),
        gs: await this.repos.buyCrypto.countBy({
          amlCheck: CheckStatus.GSHEET,
        }),
        withoutCheck: await this.repos.buyCrypto.countBy({
          amlCheck: IsNull(),
        }),
      },
      buyFiat: {
        pending: await this.repos.buyFiat.countBy({
          amlCheck: CheckStatus.PENDING,
        }),
        gs: await this.repos.buyFiat.countBy({
          amlCheck: CheckStatus.GSHEET,
        }),
        withoutCheck: await this.repos.buyFiat.countBy({
          amlCheck: IsNull(),
        }),
      },
    };
  }
}
