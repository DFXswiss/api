import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { In } from 'typeorm';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { FileSubType, FileType } from '../dto/kyc-file.dto';
import {
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

  constructor(
    private readonly kycDocumentService: KycDocumentService,
    private readonly kycFileRepo: KycFileRepository,
    @Inject(forwardRef(() => UserDataService)) private readonly userDataService: UserDataService,
  ) {}

  async syncLegacyFiles(dryRun: boolean, userDataId?: number): Promise<LegacyFileSyncDto> {
    const keys = await this.listKeys(userDataId);
    const { keysByOwner, invalidKeys } = this.groupByOwner(keys);

    const ownerIds = Array.from(keysByOwner.keys());
    const knownOwnerIds = await this.getKnownOwnerIds(ownerIds);

    const typeCounts = new Map<string, number>();
    const skipCounts = new Map<LegacyFileSkipReason, number>();
    const examples: LegacyFileEntry[] = [];
    let inserted = 0;
    let wouldInsert = 0;

    this.count(skipCounts, LegacyFileSkipReason.INVALID_PATH, invalidKeys);

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

        for (const entry of newEntries) {
          this.count(typeCounts, `${entry.type}/${entry.subType ?? ''}`, 1);
          if (examples.length < MAX_EXAMPLES) examples.push(entry);
        }

        wouldInsert += newEntries.length;

        if (!dryRun) {
          const created = await this.createFiles(newEntries);
          inserted += created.inserted;
          this.count(skipCounts, LegacyFileSkipReason.ALREADY_CATALOGED, created.conflicts);
        }
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
    };
  }

  // --- HELPER METHODS --- //

  private async listKeys(userDataId?: number): Promise<string[]> {
    if (!userDataId) return this.kycDocumentService.listKeysByPrefix(SPIDER_PREFIX);

    const keys = await Promise.all([
      this.kycDocumentService.listKeysByPrefix(`${SPIDER_PREFIX}${userDataId}/`),
      this.kycDocumentService.listKeysByPrefix(`${SPIDER_PREFIX}${userDataId}${ORGANIZATION_SUFFIX}/`),
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
  private async createFiles(entries: LegacyFileEntry[]): Promise<CreateFilesResult> {
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
