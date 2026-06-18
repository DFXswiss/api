import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { ArchiveService } from './archive.service';

/**
 * Stage 3 of the GeBüV anchoring pipeline: drives {@link ArchiveService} on a schedule.
 *
 * Uses the repo-wide `@DfxCron` decorator (see src/shared/utils/cron.ts), which the
 * central DfxCronService discovers at boot and runs behind a per-method `@Lock` plus a
 * `Process` guard — so a disabled process or a multi-instance deployment never double-runs
 * the same job. Each job is additionally wrapped in try/catch with structured logging so a
 * single failure (e.g. an OpenTimestamps calendar outage) never crashes the scheduler.
 */
@Injectable()
export class ArchiveScheduler {
  private readonly logger = new DfxLogger(ArchiveScheduler);

  constructor(private readonly archiveService: ArchiveService) {}

  @DfxCron(CronExpression.EVERY_DAY_AT_2AM, { process: Process.ARCHIVE_ANCHOR, timeout: 3600 })
  async anchorPending(): Promise<void> {
    try {
      const batch = await this.archiveService.anchorPending();

      if (batch) {
        this.logger.info(`Anchored batch ${batch.id} with Merkle root ${batch.merkleRoot}`);
      } else {
        this.logger.verbose('No unanchored archive files to anchor');
      }
    } catch (e) {
      this.logger.error('Failed to anchor pending archive files:', e);
    }
  }

  @DfxCron(CronExpression.EVERY_HOUR, { process: Process.ARCHIVE_UPGRADE, timeout: 1800 })
  async upgradeBatches(): Promise<void> {
    try {
      await this.archiveService.upgradeBatches();
    } catch (e) {
      this.logger.error('Failed to upgrade pending archive batches:', e);
    }
  }
}
