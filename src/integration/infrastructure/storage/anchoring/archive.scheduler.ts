import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { IsNull, Not } from 'typeorm';
import { createStorageService } from '../storage.factory';
import { ArchiveService } from './archive.service';
import { sha256 } from './merkle';

// Mirrors KYC_CONTAINER in kyc-document.service.ts — duplicated rather than imported so this
// low-level storage/anchoring module does not depend on the KYC domain module.
const KYC_BUCKET = 'kyc';

// Caps how many missing objects get backfilled per reconcile run so a huge one-off gap (e.g. after
// a migration) cannot blow the job's 3600s @DfxCron timeout or exhaust memory/sockets fetching
// every object in one Promise chain. The job is idempotent and re-runs daily, so anything beyond
// the cap is simply backfilled on a later run — the gap is never silently dropped, just deferred
// (and logged loudly below).
const RECONCILE_BACKFILL_BATCH_SIZE = 5000;

/**
 * Stage 3 of the GeBüV anchoring pipeline: drives {@link ArchiveService} on a schedule.
 *
 * Uses the repo-wide `@DfxCron` decorator (see src/shared/utils/cron.ts), which the
 * central DfxCronService discovers at boot and runs behind a per-method `@Lock` plus a
 * `Process` guard — so a disabled process or a multi-instance deployment never double-runs
 * the same job.
 */
@Injectable()
export class ArchiveScheduler {
  private readonly logger = new DfxLogger(ArchiveScheduler);

  constructor(
    private readonly archiveService: ArchiveService,
    private readonly repos: RepositoryFactory,
  ) {}

  @DfxCron(CronExpression.EVERY_DAY_AT_2AM, { process: Process.ARCHIVE_ANCHOR, timeout: 3600 })
  async anchorPending(): Promise<void> {
    const batch = await this.archiveService.anchorPending();

    if (batch) {
      this.logger.info(`Anchored batch ${batch.id} with Merkle root ${batch.merkleRoot}`);
    } else {
      this.logger.verbose('No unanchored archive files to anchor');
    }
  }

  @DfxCron(CronExpression.EVERY_HOUR, { process: Process.ARCHIVE_UPGRADE, timeout: 1800 })
  async upgradeBatches(): Promise<void> {
    await this.archiveService.upgradeBatches();
  }

  @DfxCron(CronExpression.EVERY_DAY_AT_1AM, { process: Process.ARCHIVE_RECONCILE, timeout: 3600 })
  async reconcileHashes(): Promise<void> {
    const buckets = await this.reconciliationBuckets();

    for (const bucket of buckets) {
      try {
        await this.reconcileBucket(bucket);
      } catch (e) {
        this.logger.error(`Failed to reconcile archive hashes for bucket ${bucket}:`, e);
      }
    }
  }

  // Retention-relevant buckets: the fixed KYC bucket plus every distinct EP2 settlement-report
  // container currently configured on any UserData (resolved the same way
  // fiat-output-job.service.ts resolves it at write time — these are per-merchant, runtime-only,
  // and cannot be hardcoded).
  private async reconciliationBuckets(): Promise<string[]> {
    const userDatas = await this.repos.userData.find({
      where: { paymentLinksConfig: Not(IsNull()) },
      select: { id: true, paymentLinksConfig: true },
    });

    const ep2Containers: string[] = [];
    for (const userData of userDatas) {
      try {
        const container = userData.paymentLinksConfigObj.ep2ReportContainer;
        if (container != null) ep2Containers.push(container);
      } catch (e) {
        this.logger.error(
          `Skipping UserData ${userData.id} with unparsable paymentLinksConfig during reconcile bucket enumeration:`,
          e,
        );
      }
    }

    return [...new Set([KYC_BUCKET, ...ep2Containers])];
  }

  // Diffs live storage objects against the archive index and backfills any gap left by a
  // previously failed recordHash call. A per-object recordHash failure (e.g. it throws because the
  // object is already anchored under a different hash — a legitimate re-upload/overwrite on a
  // versioned bucket) must not abort reconciliation of the remaining objects: log loudly and keep
  // going, never swallow silently.
  private async reconcileBucket(bucket: string): Promise<void> {
    const storageService = createStorageService(bucket);

    const [keys, recordedNames] = await Promise.all([
      storageService.listKeys(),
      this.archiveService.recordedNames(bucket),
    ]);

    const missing = keys.filter((key) => !recordedNames.has(key));
    if (missing.length === 0) return;

    const batch = missing.slice(0, RECONCILE_BACKFILL_BATCH_SIZE);
    if (missing.length > batch.length) {
      this.logger.warn(
        `Reconciling only ${batch.length} of ${missing.length} unrecorded archive object(s) in bucket ${bucket} this run; ${
          missing.length - batch.length
        } deferred to the next scheduled run`,
      );
    } else {
      this.logger.info(`Reconciling ${batch.length} unrecorded archive object(s) in bucket ${bucket}`);
    }

    for (const key of batch) {
      try {
        const content = await storageService.getBlob(key);
        await this.archiveService.recordHash(bucket, key, sha256(content.data).toString('hex'));
      } catch (e) {
        this.logger.error(`Failed to reconcile archive hash for ${bucket}/${key}:`, e);
      }
    }
  }
}
