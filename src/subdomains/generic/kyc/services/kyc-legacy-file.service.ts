import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { KeyDate } from 'src/integration/infrastructure/storage/storage.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { In } from 'typeorm';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { FileSubType, FileType } from '../dto/kyc-file.dto';
import {
  LegacyFileDateSourceDto,
  LegacyFileEntry,
  LegacyFileSkipReason,
  LegacyFileSyncDto,
  LegacyFileTypeCountDto,
  MaxDbId,
} from '../dto/kyc-legacy-file.dto';
import { KycLegacyFileMapper } from '../dto/mapper/kyc-legacy-file.mapper';
import { KycFile } from '../entities/kyc-file.entity';
import { KycFileRepository } from '../repositories/kyc-file.repository';
import { KycDocumentService } from './integration/kyc-document.service';

const SPIDER_PREFIX = 'spider/';
const ORGANIZATION_SUFFIX = '-organization';
const OWNER_BATCH_SIZE = 100;
const QUERY_BATCH_SIZE = 1000;
const MAX_EXAMPLES = 20;
const PROGRESS_BATCH_INTERVAL = 10;

/**
 * Marks the one-off backfill as done. The value is the completion timestamp rather than a bare
 * `true`, so the row answers WHEN the catalog was written — the question anyone comparing the
 * catalog against the storage asks first. Only its presence is read.
 */
export const LEGACY_FILE_SYNC_COMPLETED_KEY = 'legacyKycFileSyncCompleted';

interface CreateFilesResult {
  inserted: number;
  conflicts: number;
}

/**
 * Catalogs the legacy Spider-era KYC documents in `kyc_file`.
 *
 * The documents themselves stay where they are: the KYC container is a WORM store under a ten-year
 * object lock, so a blob is never copied or moved. Each row points at the existing blob through
 * `kyc_file.path` instead, which is what makes the documents visible to the compliance tooling that
 * reads the catalog rather than the storage.
 */
@Injectable()
export class KycLegacyFileService {
  private readonly logger = new DfxLogger(KycLegacyFileService);

  /** Whether the "already done" line has been written in this process; see `skipCompleted`. */
  private skipLogged = false;

  constructor(
    private readonly kycDocumentService: KycDocumentService,
    private readonly kycFileRepo: KycFileRepository,
    private readonly settingService: SettingService,
    @Inject(forwardRef(() => UserDataService)) private readonly userDataService: UserDataService,
  ) {}

  /**
   * Runs the backfill once, after the deploy that carries it.
   *
   * A job rather than the admin endpoint (`POST /kyc/admin/legacy-file/sync`, which stays for
   * single-account runs): that route is behind an admin identity cleared through staff KYC, and the
   * operator who has to start the backfill does not hold one. A job needs no caller — it starts
   * itself once the worker is up, which is the same shape the original `kyc_file` backfill used and
   * was removed again by a follow-up PR. This one is temporary in exactly the same way.
   *
   * Exactly-once is not something the scheduler can promise, and this does not need it. `LockClass`
   * keeps a second tick out of THIS process while the run is inside its declared timeout, and the
   * lease (`CronLeaseService`) keeps a second process from starting the job while the holder keeps
   * renewing; neither is a guarantee, and both say so themselves. What makes a repeat harmless is
   * the sync: `filterCataloged` and the partial unique index on `kyc_file.path` mean a blob that
   * already carries a catalog row is never catalogued twice. So no lock of its own is built here.
   * The setting is what stops the WORK once it has been done, not what makes the run unique.
   *
   * The flag is written only after the sync returned. A run that throws leaves it unset and the next
   * tick starts over, which is why the interval is not a minute: a run that fails FAST — wrong
   * storage credentials, a prefix that is not there — would otherwise repeat a full listing of the
   * `spider/` prefix sixty times an hour, and there is no backoff anywhere to stop it.
   */
  @DfxCron(CronExpression.EVERY_5_MINUTES, {
    scope: CronScope.WORKER,
    process: Process.KYC_LEGACY_FILE_SYNC,
    // Two hours, the ceiling this repository uses for long jobs. Not a budget but the point at which
    // a stalled run stops blocking the next tick in this process: the full run reads the whole
    // `spider/` prefix, so it has to be far longer than the interval, and a repeat is harmless.
    timeout: 7200,
  })
  async runBackfill(): Promise<void> {
    // Before anything else, so a completed backfill costs one indexed row read per tick on top of
    // the lease this job takes and releases like any other, and touches neither the storage nor
    // `kyc_file`.
    if (await this.isCompleted()) return this.skipCompleted();

    const startedAt = new Date();
    this.logger.info('Legacy KYC file backfill started');

    const result = await this.syncLegacyFiles(false);

    // Fail closed on an empty listing instead of latching the flag on it. Which store is read is
    // configuration (`STORAGE_READ_SOURCE`), and a store whose `spider/` prefix is not there answers
    // zero keys rather than throwing — marking THAT complete would retire the backfill silently, and
    // the follow-up PR would then remove a job that never ran.
    if (!result.keys) throw new Error('Legacy KYC file backfill found no objects under spider/');

    await this.settingService.set(LEGACY_FILE_SYNC_COMPLETED_KEY, new Date().toISOString());

    const skipped = result.skipped.map(({ reason, count }) => `${reason}: ${count}`).join(', ');
    const { fromPath, fromListing, fromDefault, oldest, newest } = result.dated;
    this.logger.info(
      `Legacy KYC file backfill complete in ${Util.round(Util.secondsDiff(startedAt), 1)} s: ${
        result.inserted
      } catalog rows written from ${result.keys} keys of ${result.owners} owner prefixes, skipped (${
        skipped || 'none'
      })`,
    );

    // Separate line, and not an afterthought on the one above: a run that dated every row by the store
    // or by nothing produces a catalog that all looks equally recent, and the span is what shows it.
    this.logger.info(
      `Legacy KYC file backfill dates: ${fromPath} from path, ${fromListing} from listing, ${fromDefault} left to the column default, spanning ${
        oldest?.toISOString() ?? 'n/a'
      } to ${newest?.toISOString() ?? 'n/a'}`,
    );
  }

  async syncLegacyFiles(dryRun: boolean, userDataId?: number): Promise<LegacyFileSyncDto> {
    const keyDates = await this.listKeyDates(userDataId);
    const keys = keyDates.map((k) => k.key);
    // The date the STORE holds for a blob. Second choice behind the date in the path: after the move
    // between storage backends every object carries the day of that move, so this dates the object
    // rather than the document. Kept anyway, because it is still older than the run for any store
    // that was not migrated, and the alternative for those rows is no date at all.
    const blobDates = new Map(keyDates.filter((k) => k.created).map((k) => [k.key, k.created]));

    const { keysByOwner, invalidKeys } = this.groupByOwner(keys);

    const ownerIds = Array.from(keysByOwner.keys());
    const knownOwnerIds = await this.getKnownOwnerIds(ownerIds);

    const typeCounts = new Map<string, number>();
    const skipCounts = new Map<LegacyFileSkipReason, number>();
    const examples: LegacyFileEntry[] = [];
    const dated: LegacyFileDateSourceDto = { fromPath: 0, fromListing: 0, fromDefault: 0 };
    let inserted = 0;
    let wouldInsert = 0;

    this.count(skipCounts, LegacyFileSkipReason.INVALID_PATH, invalidKeys);

    const totalBatches = Math.ceil(ownerIds.length / OWNER_BATCH_SIZE);
    let batchNo = 0;

    await Util.doInBatches(
      ownerIds,
      async (batch) => {
        const entries: LegacyFileEntry[] = [];

        for (const ownerId of batch) {
          const ownerKeys = keysByOwner.get(ownerId);

          // The owner id comes from a storage path, so it may point at an account that no longer
          // exists (e.g. a merged one) — such a row could not carry its mandatory user reference.
          if (!knownOwnerIds.has(ownerId)) {
            this.count(skipCounts, LegacyFileSkipReason.UNKNOWN_OWNER, ownerKeys.length);
            continue;
          }

          const mapping = KycLegacyFileMapper.toCatalogEntries(ownerId, ownerKeys);
          for (const reason of mapping.skipped) this.count(skipCounts, reason, 1);

          entries.push(...mapping.entries);
        }

        const newEntries = await this.filterCataloged(entries);
        this.count(skipCounts, LegacyFileSkipReason.ALREADY_CATALOGED, entries.length - newEntries.length);

        const dates = new Map<string, Date>();

        for (const entry of newEntries) {
          this.count(typeCounts, `${entry.type}/${entry.subType ?? ''}`, 1);
          if (examples.length < MAX_EXAMPLES) examples.push(entry);

          this.resolveDate(entry, blobDates, dates, dated);
        }

        wouldInsert += newEntries.length;

        if (!dryRun) {
          const created = await this.createFiles(newEntries, dates);
          inserted += created.inserted;
          this.count(skipCounts, LegacyFileSkipReason.ALREADY_CATALOGED, created.conflicts);
        }

        // A full run works through some hundred batches over many minutes, and between the first and
        // the last line there is nothing to tell "still working" from "stuck" — the job runs on the
        // worker, so there is no request to ask either. Every tenth batch is a handful of lines for
        // the whole run and none at all for the single-account runs the admin route starts.
        if (++batchNo % PROGRESS_BATCH_INTERVAL === 0)
          this.logger.info(
            `Legacy KYC file sync: batch ${batchNo}/${totalBatches}, ${wouldInsert} catalog rows so far (${inserted} written)`,
          );
      },
      OWNER_BATCH_SIZE,
    );

    this.logger.info(
      `Legacy KYC file sync (${dryRun ? 'dry run' : 'write'}): ${keys.length} keys of ${
        ownerIds.length
      } owners, ${wouldInsert} catalog rows, ${inserted} written`,
    );

    return {
      dryRun,
      owners: ownerIds.length,
      keys: keys.length,
      inserted,
      wouldInsert,
      byType: this.toTypeCounts(typeCounts),
      skipped: Array.from(skipCounts.entries()).map(([reason, count]) => ({ reason, count })),
      examples,
      dated,
    };
  }

  // --- HELPER METHODS --- //

  /**
   * The date one catalog row is written with, and where it came from.
   *
   * The path first: it is the only source that dates the DOCUMENT. The store's date second, which
   * after a migration between backends is the date of that migration for every object alike. Nothing
   * third, leaving the column default — the row is then stamped with the run, which is what every
   * row of this backfill would carry without any of this.
   */
  private resolveDate(
    entry: LegacyFileEntry,
    blobDates: Map<string, Date>,
    dates: Map<string, Date>,
    dated: LegacyFileDateSourceDto,
  ): void {
    const date = entry.date ?? blobDates.get(entry.path);

    if (entry.date) dated.fromPath++;
    else if (date) dated.fromListing++;
    else dated.fromDefault++;

    if (!date) return;

    dates.set(entry.path, date);
    dated.oldest = dated.oldest && dated.oldest < date ? dated.oldest : date;
    dated.newest = dated.newest && dated.newest > date ? dated.newest : date;
  }

  // Presence, not a value: the setting carries the completion timestamp. Read on every tick rather
  // than cached in a field, so clearing the row is enough to make the backfill run again — the
  // rollback path needs no restart.
  private async isCompleted(): Promise<boolean> {
    return (await this.settingService.get(LEGACY_FILE_SYNC_COMPLETED_KEY)) != null;
  }

  // Once per process, because the job keeps ticking until the follow-up PR removes it and every
  // later line would say nothing the first one did not. The flag is checked before the log call
  // rather than around it, so the skip itself stays silent afterwards.
  private skipCompleted(): void {
    if (this.skipLogged) return;

    this.skipLogged = true;
    this.logger.info(`Legacy KYC file backfill already completed (${LEGACY_FILE_SYNC_COMPLETED_KEY}), skipping`);
  }

  private async listKeyDates(userDataId?: number): Promise<KeyDate[]> {
    if (!userDataId) return this.kycDocumentService.listKeyDatesByPrefix(SPIDER_PREFIX);

    const keys = await Promise.all([
      this.kycDocumentService.listKeyDatesByPrefix(`${SPIDER_PREFIX}${userDataId}/`),
      this.kycDocumentService.listKeyDatesByPrefix(`${SPIDER_PREFIX}${userDataId}${ORGANIZATION_SUFFIX}/`),
    ]);

    return keys.flat();
  }

  // `spider/<userDataId>/…` and `spider/<userDataId>-organization/…` are the personal and the business
  // documents of one and the same account, so both prefixes are catalogued under that account.
  private groupByOwner(keys: string[]): { keysByOwner: Map<number, string[]>; invalidKeys: number } {
    const keysByOwner = new Map<number, string[]>();
    let invalidKeys = 0;

    for (const key of keys) {
      const ownerSegment = key.split('/')[1] ?? '';
      const owner = ownerSegment.endsWith(ORGANIZATION_SUFFIX)
        ? ownerSegment.slice(0, -ORGANIZATION_SUFFIX.length)
        : ownerSegment;
      const ownerId = +owner;

      // The segment is only an account id if it reads like one and fits the int4 column it is matched
      // against — a longer digit sequence (a timestamp, say) would otherwise reach the query and make
      // Postgres fail the whole run with a numeric range error.
      if (!Config.formats.number.test(owner) || ownerId > MaxDbId) {
        invalidKeys++;
        continue;
      }

      const ownerKeys = keysByOwner.get(ownerId) ?? [];
      ownerKeys.push(key);
      keysByOwner.set(ownerId, ownerKeys);
    }

    return { keysByOwner, invalidKeys };
  }

  private async getKnownOwnerIds(ownerIds: number[]): Promise<Set<number>> {
    const knownIds = await Util.doInBatchesAndJoin(
      ownerIds,
      (batch) => this.userDataService.getExistingUserDataIds(batch),
      QUERY_BATCH_SIZE,
    );

    return new Set(knownIds);
  }

  // Idempotency: a blob that already has a catalog row is never catalogued twice, so the sync can be
  // re-run — after a failure, or for accounts added since — without producing duplicates.
  private async filterCataloged(entries: LegacyFileEntry[]): Promise<LegacyFileEntry[]> {
    if (!entries.length) return [];

    const cataloged = await Util.doInBatchesAndJoin(
      entries.map((e) => e.path),
      (batch) => this.kycFileRepo.find({ where: { path: In(batch) }, select: { path: true } }),
      QUERY_BATCH_SIZE,
    );

    const catalogedPaths = new Set(cataloged.map((f) => f.path));

    return entries.filter((e) => !catalogedPaths.has(e.path));
  }

  // The catalog check and the insert are two statements, so an overlapping run of this same job — the
  // full run is long enough for an admin to start a second one — can write a row in between. The partial
  // unique index on `path` is what turns that race into a conflict instead of a duplicate document, and
  // the conflict is counted like any other already-catalogued blob so the run finishes either way.
  private async createFiles(entries: LegacyFileEntry[], dates: Map<string, Date>): Promise<CreateFilesResult> {
    if (!entries.length) return { inserted: 0, conflicts: 0 };

    const files = entries.map((e) =>
      this.kycFileRepo.create({
        name: e.name,
        type: e.type,
        subType: e.subType,
        path: e.path,
        protected: true,
        valid: true,
        uid: Util.createUid(Config.prefixes.kycFileUidPrefix),
        userData: { id: e.userDataId },
        // The document's date, so the row dates the document rather than the backfill - see
        // `resolveDate` for where it comes from. TypeORM keeps an explicitly set `@CreateDateColumn`
        // on insert (only the Mongo driver overwrites it), and `legacy-file-created.projection.spec.ts`
        // holds that against a real database. Left unset where no date could be established: the
        // column default then stamps the run, which is what every row would carry without any of this.
        created: dates.get(e.path),
      }),
    );

    try {
      await this.kycFileRepo.save(files);
      this.kycFileRepo.invalidateCache();

      return { inserted: files.length, conflicts: 0 };
    } catch (e) {
      if (!this.isPathConflict(e)) throw e;

      return this.createFilesIndividually(files);
    }
  }

  // One conflicting blob must not cost the rest of its batch, so the batch is written again row by row.
  private async createFilesIndividually(files: KycFile[]): Promise<CreateFilesResult> {
    let inserted = 0;
    let conflicts = 0;

    for (const file of files) {
      try {
        await this.kycFileRepo.save(file);
        inserted++;
      } catch (e) {
        if (!this.isPathConflict(e)) throw e;
        conflicts++;
      }
    }

    if (inserted) this.kycFileRepo.invalidateCache();

    return { inserted, conflicts };
  }

  // Postgres unique_violation (SQLSTATE 23505) on the partial unique index over `path`. Any other unique
  // violation — a uid collision, say — is a different fault and stays an error.
  private isPathConflict(error: unknown): boolean {
    const e = error as { code?: string; constraint?: string };
    const pathIndex = this.kycFileRepo.metadata.indices.find(
      (i) => i.isUnique && i.columns.some((c) => c.propertyName === 'path'),
    )?.name;

    return e?.code === '23505' && e.constraint != null && e.constraint === pathIndex;
  }

  private count<T>(counts: Map<T, number>, key: T, amount: number): void {
    if (amount > 0) counts.set(key, (counts.get(key) ?? 0) + amount);
  }

  private toTypeCounts(typeCounts: Map<string, number>): LegacyFileTypeCountDto[] {
    return Array.from(typeCounts.entries()).map(([key, count]) => {
      const [type, subType] = key.split('/');
      return { type: type as FileType, subType: (subType as FileSubType) || undefined, count };
    });
  }
}
