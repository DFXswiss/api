import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { FileSubType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';

interface TravelRuleData {
  // candidates with a signature, no PDF yet and kycLevel >= 40 — i.e. the job's open backlog
  backlog: number;
  // age of the oldest open candidate in hours, based on user.updated (claim/signature recency, not
  // account age); null when the backlog is empty
  oldestAgeHours: number | null;
  // users that claimed a PDF (travelRulePdfDate set) but have no valid AddressSignature kyc_file —
  // i.e. the upload-rollback-failed case the migration guards against (claim leak / orphan blob)
  claimedWithoutFile: number;
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

  // The whole migration exists because the sheet failed silently from 18.06. on. These metrics make
  // a stuck job visible: a growing backlog or an old oldest-candidate signals the PDF pipeline is
  // not draining anymore (job disabled, upload errors, claim leaks); claimedWithoutFile catches the
  // inverse failure where a candidate was claimed but the rollback after a failed upload did not
  // run (orphan claim without a valid blob).
  private async getTravelRule(): Promise<TravelRuleData> {
    const { backlog, oldest } = await this.repos.user
      .createQueryBuilder('user')
      .select('COUNT(user.id)', 'backlog')
      // oldest is candidate-near (user.updated = signature/claim recency), not MIN(user.created)
      // which would just report the oldest account regardless of the candidate's own age
      .addSelect('MIN(user.updated)', 'oldest')
      .leftJoin('user.userData', 'userData')
      .where('user.signature IS NOT NULL')
      .andWhere('user.travelRulePdfDate IS NULL')
      .andWhere('user.custodyProviderId IS NULL')
      .andWhere('userData.kycLevel >= :level', { level: KycLevel.LEVEL_40 })
      .getRawOne<{ backlog: string; oldest: Date | null }>();

    const { claimedWithoutFile } = await this.repos.user
      .createQueryBuilder('user')
      .select('COUNT(user.id)', 'claimedWithoutFile')
      .where('user.travelRulePdfDate IS NOT NULL')
      .andWhere(
        // no valid AddressSignature kyc_file exists for this user's userData
        `NOT EXISTS (
          SELECT 1 FROM kyc_file kf
          WHERE kf.userDataId = user.userDataId
            AND kf.subType = :subType
            AND kf.valid = :valid
        )`,
        { subType: FileSubType.ADDRESS_SIGNATURE, valid: true },
      )
      .getRawOne<{ claimedWithoutFile: string }>();

    return {
      backlog: +backlog,
      oldestAgeHours: oldest ? Util.round(Util.hoursDiff(new Date(oldest)), 1) : null,
      claimedWithoutFile: +claimedWithoutFile,
    };
  }
}
