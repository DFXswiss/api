import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { IsNull } from 'typeorm';

interface UserData {
  userWithout: UserWithout;
}

interface UserWithout {
  ipCountry: number;
}

@Injectable()
export class UserObserver extends MetricObserver<UserData> {
  protected readonly logger: DfxLoggerService;

  constructor(
    private readonly dfxLogger: DfxLoggerService,
    monitoringService: MonitoringService,
    private readonly repos: RepositoryFactory,
  ) {
    super(monitoringService, 'user', 'kyc');

    this.logger = this.dfxLogger.create(UserObserver);
  }

  @DfxCron(CronExpression.EVERY_10_MINUTES, { process: Process.MONITORING, timeout: 1800 })
  async fetch(): Promise<UserData> {
    const data = await this.getUser();

    this.emit(data);

    return data;
  }

  // *** HELPER METHODS *** //

  private async getUser(): Promise<UserData> {
    return {
      userWithout: await this.getUserWithout(),
    };
  }

  private async getUserWithout(): Promise<UserWithout> {
    return { ipCountry: await this.repos.user.countBy({ ipCountry: IsNull() }) };
  }
}
