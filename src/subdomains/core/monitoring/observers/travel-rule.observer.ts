import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';

interface TravelRuleData {
  // candidates with a signature, no PDF yet and kycLevel >= 40 — i.e. the job's open backlog
  backlog: number;
  // age of the oldest open candidate in hours; null when the backlog is empty
  oldestAgeHours: number | null;
}

@Injectable()
export class TravelRuleObserver extends MetricObserver<TravelRuleData> {
  protected readonly logger = new DfxLogger(TravelRuleObserver);

  constructor(
    monitoringService: MonitoringService,
    private readonly repos: RepositoryFactory,
  ) {
    super(monitoringService, 'travelRule', 'pdf');
  }

  @DfxCron(CronExpression.EVERY_10_MINUTES, { process: Process.MONITORING, timeout: 1800 })
  async fetch(): Promise<TravelRuleData> {
    const data = await this.getTravelRule();

    this.emit(data);

    return data;
  }

  // *** HELPER METHODS *** //

  // The whole migration exists because the sheet failed silently from 18.06. on. This metric makes
  // a stuck job visible: a growing backlog or an old oldest-candidate signals the PDF pipeline is
  // not draining anymore (job disabled, upload errors, claim leaks).
  private async getTravelRule(): Promise<TravelRuleData> {
    const { backlog, oldest } = await this.repos.user
      .createQueryBuilder('user')
      .select('COUNT(user.id)', 'backlog')
      .addSelect('MIN(user.created)', 'oldest')
      .leftJoin('user.userData', 'userData')
      .where('user.signature IS NOT NULL')
      .andWhere('user.travelRulePdfDate IS NULL')
      .andWhere('user.custodyProviderId IS NULL')
      .andWhere('userData.kycLevel >= :level', { level: KycLevel.LEVEL_40 })
      .getRawOne<{ backlog: string; oldest: Date | null }>();

    return {
      backlog: +backlog,
      oldestAgeHours: oldest ? Util.round(Util.hoursDiff(new Date(oldest)), 1) : null,
    };
  }
}
