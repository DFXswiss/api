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
import { TravelRuleSignature } from 'src/subdomains/generic/user/models/user/travel-rule-signature';

interface TravelRuleData {
  // PROCESSABLE candidates only: a signature, no PDF yet, kycLevel >= 40, non-custody AND a
  // signature format the job actually renders (TravelRuleSignature.isValid). This is the job's open
  // backlog that can still drain — the primary, robust stuck indicator.
  backlog: number;
  // candidates whose signature format the job never renders (e.g. an EVM signature missing the 0x prefix). They keep
  // travelRulePdfDate IS NULL forever by design, so they MUST NOT inflate `backlog` and trigger a
  // false-positive stuck alert. Tracked separately, expected to be roughly constant.
  skippedUnrecognised: number;
  // APPROXIMATE age (hours) of the oldest processable candidate, derived from user.updated. NOTE:
  // user.updated is an @UpdateDateColumn that bumps on EVERY save, not just on signature/claim — so
  // this is "time since last change" and only a rough lower bound on true stuck age, never an exact
  // stuck duration. `backlog` is the authoritative indicator; null when there is no backlog.
  oldestAgeHours: number | null;
  // users that claimed a PDF (travelRulePdfDate set) but have no valid AddressSignature kyc_file —
  // i.e. the upload-rollback-failed case the catch-rollback guards against (claim leak / orphan blob)
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

  // This whole Sheet-to-API replacement exists because the sheet failed silently from 18.06. on. These metrics make
  // a stuck job visible: a growing `backlog` (the robust primary indicator) signals the PDF pipeline
  // is not draining anymore (job disabled, upload errors, claim leaks); claimedWithoutFile catches
  // the inverse failure where a candidate was claimed but the rollback after a failed upload did not
  // run (orphan claim without a valid blob).
  private async getTravelRule(): Promise<TravelRuleData> {
    // Fetch the raw candidates (one signature/updated column pair) that share the EXACT same WHERE
    // condition as the job's candidate query, then split them in-code with the SAME
    // TravelRuleSignature.isValid the job uses. Doing the format split in-code (instead of in SQL)
    // keeps a single source of truth for the allowlist and guarantees observer and job agree on what
    // is processable — otherwise candidates the job permanently skips would show up as stuck backlog.
    const candidates = await this.repos.user
      .createQueryBuilder('user')
      .select('user.signature', 'signature')
      .addSelect('user.updated', 'updated')
      .leftJoin('user.userData', 'userData')
      .where('user.signature IS NOT NULL')
      .andWhere('user.travelRulePdfDate IS NULL')
      .andWhere('user.custodyProviderId IS NULL')
      .andWhere('userData.kycLevel >= :level', { level: KycLevel.LEVEL_40 })
      .getRawMany<{ signature: string; updated: Date }>();

    const processable = candidates.filter((c) => TravelRuleSignature.isValid(c.signature));

    // approximate: user.updated is an @UpdateDateColumn (see interface doc) — lower bound on age
    const oldestUpdated = processable.reduce<Date | null>(
      (oldest, c) => (!oldest || c.updated < oldest ? c.updated : oldest),
      null,
    );

    const { claimedWithoutFile } = await this.repos.user
      .createQueryBuilder('user')
      .select('COUNT(user.id)', 'claimedWithoutFile')
      .where('user.travelRulePdfDate IS NOT NULL')
      .andWhere(
        // no valid AddressSignature kyc_file exists for this user's userData.
        // `kf` is a raw table alias, NOT a TypeORM-registered alias, so TypeORM does not auto-quote
        // its identifiers. PostgreSQL folds unquoted identifiers to lowercase, which turns the
        // camelCase FK columns into non-existent `userdataid`/`subtype` columns ("column does not
        // exist" at runtime). We therefore double-quote the camelCase identifiers manually so they
        // survive verbatim. `valid` is lowercase and needs no quoting; the main `user` alias is the
        // one TypeORM already double-quotes, so we reference it the same way.
        `NOT EXISTS (
          SELECT 1 FROM kyc_file kf
          WHERE kf."userDataId" = "user"."userDataId"
            AND kf."subType" = :subType
            AND kf.valid = :valid
        )`,
        { subType: FileSubType.ADDRESS_SIGNATURE, valid: true },
      )
      .getRawOne<{ claimedWithoutFile: string }>();

    return {
      backlog: processable.length,
      skippedUnrecognised: candidates.length - processable.length,
      oldestAgeHours: oldestUpdated ? Util.round(Util.hoursDiff(new Date(oldestUpdated)), 1) : null,
      claimedWithoutFile: +claimedWithoutFile,
    };
  }
}
