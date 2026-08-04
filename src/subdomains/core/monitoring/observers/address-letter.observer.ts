import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { LetterService } from 'src/integration/letter/letter.service';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { Config } from 'src/config/config';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { FileSubType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import {
  applyCompleteAddress,
  applyLetterEligibility,
} from 'src/subdomains/generic/user/models/user-data/address-letter-job.service';
import { IsNull, LessThan } from 'typeorm';

interface AddressLetterData {
  // Accounts the job can actually serve right now: eligible, printable address, retries left. The
  // primary indicator - a backlog that stops draining means the dispatch stopped working.
  backlog: number;
  // Eligible accounts the job can never serve because part of their postal address is missing. Kept
  // out of `backlog` so a constant, expected population cannot look like a stuck queue.
  incompleteAddress: number;
  // Accounts that used up their retries (`Config.letter.addressLetter.maxFailures`). They leave the
  // backlog by design and
  // need a decision, so they are counted rather than hidden.
  exhausted: number;
  // Claimed, still unsent, and older than the grace period: the dispatch outcome is unknown and the
  // job will never retry it on its own (a second physical letter cannot be undone). Every unit here
  // is an account waiting for a human - the metric that must not sit above zero.
  claimedWithoutLetter: number;
  // Letters this job dispatched whose PDF never reached the KYC file store. `letterClaimDate IS NOT
  // NULL` restricts this to accounts the job itself handled: a few thousand accounts carry a historic
  // `letterSentDate` from before this job without a `PostDispatch` file and would otherwise drown it.
  //
  // LIMIT: it counts rows, and `KycDocumentService.uploadFile` writes the row before the blob. A failed
  // upload is caught and the row invalidated, so that case is covered - but a hard crash between the
  // two leaves a valid row with no blob, which this metric reads as present. Closing that would mean
  // changing the shared upload path for every caller; storage reconciliation is the tool for it.
  sentWithoutFile: number;
  // APPROXIMATE age (hours) of the oldest processable candidate, derived from `user_data.updated`.
  // That is an @UpdateDateColumn bumped by every save, so this is "time since last change" and only a
  // lower bound on the true waiting time. `backlog` is the authoritative signal; null when empty.
  oldestAgeHours: number | null;
  // Hours since the most recent letter went out, over all accounts. This is the metric that would have
  // caught the multi-day outage preceding this job: at a few dozen letters a day, anything above 24
  // means the dispatch is broken - no matter how green the job itself looks. Null if none was ever
  // sent.
  hoursSinceLastLetter: number | null;
  // Credit left at the dispatch provider. Runs out silently otherwise: an empty balance makes every
  // send fail, and no amount of job-side health tells you why. Null if unconfigured or unreachable.
  letterBalance: number | null;
}

@Injectable()
export class AddressLetterObserver extends MetricObserver<AddressLetterData> {
  protected readonly logger = new DfxLogger(AddressLetterObserver);

  constructor(
    monitoringService: MonitoringService,
    private readonly repos: RepositoryFactory,
    private readonly letterService: LetterService,
  ) {
    super(monitoringService, 'addressLetter', 'dispatch');
  }

  @DfxCron(CronExpression.EVERY_10_MINUTES, { scope: CronScope.WORKER, process: Process.MONITORING, timeout: 1800 })
  async fetch(): Promise<AddressLetterData> {
    const data = await this.getAddressLetter();

    this.emit(data);

    return data;
  }

  // *** HELPER METHODS *** //

  private async getAddressLetter(): Promise<AddressLetterData> {
    const [backlog, oldestUpdated] = await this.getBacklog();

    return {
      backlog,
      oldestAgeHours: oldestUpdated ? Util.round(Util.hoursDiff(oldestUpdated), 1) : null,
      incompleteAddress: await this.getIncompleteAddress(),
      exhausted: await this.getExhausted(),
      claimedWithoutLetter: await this.repos.userData.countBy({
        letterClaimDate: LessThan(Util.minutesBefore(Config.letter.addressLetter.claimGraceMinutes)),
        letterSentDate: IsNull(),
      }),
      sentWithoutFile: await this.getSentWithoutFile(),
      hoursSinceLastLetter: await this.getHoursSinceLastLetter(),
      letterBalance: await this.getLetterBalance(),
    };
  }

  /** Size and age of the servable queue, from the same predicate the job selects with. */
  private async getBacklog(): Promise<[number, Date | null]> {
    const query = this.repos.userData
      .createQueryBuilder('userData')
      .select('MIN(userData.updated)', 'oldestUpdated')
      .addSelect('COUNT(userData.id)', 'backlog')
      .leftJoin('userData.country', 'country');

    const { backlog, oldestUpdated } = await applyCompleteAddress(applyLetterEligibility(query))
      // The job never picks a claimed account up again, so a claim must leave the servable queue -
      // otherwise a stray claim shows up as backlog AND as claimedWithoutLetter, and the queue looks
      // stalled while nothing is actually waiting for the job.
      .andWhere('userData.letterClaimDate IS NULL')
      .andWhere('userData.letterFailures < :maxFailures', { maxFailures: Config.letter.addressLetter.maxFailures })
      .getRawOne<{ backlog: string; oldestUpdated: Date | null }>();

    return [+backlog, oldestUpdated];
  }

  private async getIncompleteAddress(): Promise<number> {
    const query = this.repos.userData
      .createQueryBuilder('userData')
      .select('COUNT(userData.id)', 'incomplete')
      .leftJoin('userData.country', 'country');

    const { incomplete } = await applyLetterEligibility(query)
      .andWhere(
        `(NULLIF(BTRIM(userData.street), '') IS NULL OR NULLIF(BTRIM(userData.zip), '') IS NULL
          OR NULLIF(BTRIM(userData.location), '') IS NULL OR NULLIF(BTRIM(country.name), '') IS NULL)`,
      )
      .getRawOne<{ incomplete: string }>();

    return +incomplete;
  }

  private async getExhausted(): Promise<number> {
    const query = this.repos.userData
      .createQueryBuilder('userData')
      .select('COUNT(userData.id)', 'exhausted')
      .leftJoin('userData.country', 'country');

    const { exhausted } = await applyLetterEligibility(query)
      .andWhere('userData.letterFailures >= :maxFailures', { maxFailures: Config.letter.addressLetter.maxFailures })
      .getRawOne<{ exhausted: string }>();

    return +exhausted;
  }

  // Anti-join rather than a raw `NOT EXISTS` subquery: written by hand, the subquery would name the
  // table and its camelCase columns as literal SQL, which is unqualified by schema and unquoted unless
  // every identifier is escaped by hand - both failures are invisible in a mocked unit test and only
  // surface at runtime. Joining the mapped relation leaves table path and quoting to TypeORM. The join
  // condition carries the file filter, so the anti-join keeps exactly the accounts with no such file.
  private async getSentWithoutFile(): Promise<number> {
    const { sentWithoutFile } = await this.repos.userData
      .createQueryBuilder('userData')
      .select('COUNT(userData.id)', 'sentWithoutFile')
      .leftJoin('userData.kycFiles', 'kycFile', 'kycFile.subType = :subType AND kycFile.valid = :valid', {
        subType: FileSubType.POST_DISPATCH,
        valid: true,
      })
      .where('userData.letterClaimDate IS NOT NULL')
      .andWhere('userData.letterSentDate IS NOT NULL')
      .andWhere('kycFile.id IS NULL')
      .getRawOne<{ sentWithoutFile: string }>();

    return +sentWithoutFile;
  }

  private async getHoursSinceLastLetter(): Promise<number | null> {
    const { lastSent } = await this.repos.userData
      .createQueryBuilder('userData')
      .select('MAX(userData.letterSentDate)', 'lastSent')
      .getRawOne<{ lastSent: Date | null }>();

    return lastSent ? Util.round(Util.hoursDiff(lastSent), 1) : null;
  }

  /** Never lets the provider break the whole metric set - a missing balance is reported as unknown. */
  private async getLetterBalance(): Promise<number | null> {
    if (!this.letterService.isConfigured) return null;

    return this.letterService.getBalance().catch((e) => {
      this.logger.error('Failed to read the letter provider balance', e);
      return null;
    });
  }
}
