import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { IsNull } from 'typeorm';
import { ArchiveBatch, ArchiveBatchStatus } from './archive-batch.entity';
import { ArchiveBatchRepository } from './archive-batch.repository';
import { ArchiveFile } from './archive-file.entity';
import { ArchiveFileRepository } from './archive-file.repository';
import { buildMerkleRoot, merkleInclusionProof, sha256, verifyMerkleProof } from './merkle';
import { OpenTimestampsService } from './opentimestamps.service';

/** Result of verifying an archived document against its anchored Merkle batch. */
export interface ArchiveVerification {
  /** false if no archive record exists for the given `(bucket, name)`. */
  found: boolean;
  /** true if the stored SHA-256 equals the hash recomputed from the supplied data. */
  hashMatches?: boolean;
  /** true once the file has been assigned to a Merkle batch. */
  anchored?: boolean;
  /** true if the inclusion proof recomputes the batch's stored Merkle root. */
  proofValid?: boolean;
  /** Bitcoin block height of the OpenTimestamps attestation, once anchored on-chain. */
  bitcoinHeight?: number;
  /** true while the OpenTimestamps proof is still calendar-only (not yet on-chain). */
  pending?: boolean;
}

/**
 * Stage 2 of the GeBüV anchoring pipeline: it records content hashes of archived storage
 * objects, batches the still-unanchored ones into a daily Merkle tree, timestamps the root
 * via OpenTimestamps (Stage 1 primitives), upgrades those proofs to Bitcoin attestations,
 * and verifies a given document against its anchored batch end-to-end.
 *
 * Leaves are the raw 32-byte SHA-256 digests of the file contents (the Merkle module does
 * NOT re-hash leaves). `merkleRoot` is stored hex, `otsProof` is stored base64 of the
 * serialized detached `.ots` bytes.
 */
@Injectable()
export class ArchiveService {
  private readonly logger = new DfxLogger(ArchiveService);

  constructor(
    private readonly archiveBatchRepo: ArchiveBatchRepository,
    private readonly archiveFileRepo: ArchiveFileRepository,
    private readonly ots: OpenTimestampsService,
  ) {}

  /**
   * Idempotently record the SHA-256 of an archived object identified by `(bucket, name)`.
   *
   * Only UNANCHORED records may be updated in place (their hash refreshed, kept unanchored);
   * a new record is created unanchored (`batch` null). Anchoring happens later via
   * {@link anchorPending}.
   *
   * Once a record has been assigned to a Merkle batch its leaf hash is immutable: it is part
   * of a (possibly already Bitcoin-anchored) proof. Because KYC blob names are deterministic,
   * a re-upload to the same `(bucket, name)` would otherwise silently overwrite the anchored
   * leaf hash and make {@link verifyDocument} report bogus tampering. Therefore, for an
   * already-anchored record: an identical hash is a no-op, and a differing hash is a hard
   * error (the existing anchored hash is never overwritten).
   */
  async recordHash(bucket: string, name: string, sha256Hex: string): Promise<void> {
    const existing = await this.archiveFileRepo.findOne({ where: { bucket, name }, relations: ['batch'] });

    if (existing) {
      if (existing.batch != null) {
        if (existing.sha256 === sha256Hex) return;

        const message =
          `Refusing to overwrite anchored hash for ${bucket}/${name} (file ${existing.id}, batch ` +
          `${existing.batch.id}): stored ${existing.sha256} differs from new ${sha256Hex}`;
        this.logger.error(message);
        throw new Error(message);
      }

      await this.archiveFileRepo.update(existing.id, { sha256: sha256Hex });
      return;
    }

    const file = this.archiveFileRepo.create({ bucket, name, sha256: sha256Hex });
    await this.archiveFileRepo.save(file);
  }

  /**
   * Batch all currently unanchored files (ordered by id) into one Merkle tree, timestamp its
   * root via OpenTimestamps, and persist batch + per-file assignment in a single transaction.
   *
   * Returns the created batch, or `undefined` if there is nothing to anchor.
   */
  async anchorPending(): Promise<ArchiveBatch | undefined> {
    const files = await this.archiveFileRepo.find({ where: { batch: IsNull() }, order: { id: 'ASC' } });
    if (files.length === 0) return undefined;

    const leaves = files.map((file) => Buffer.from(file.sha256, 'hex'));
    const root = buildMerkleRoot(leaves);

    const otsBytes = await this.ots.stamp(root);

    const batch = this.archiveBatchRepo.create({
      merkleRoot: root.toString('hex'),
      otsProof: otsBytes.toString('base64'),
      status: ArchiveBatchStatus.PENDING_BTC,
    });

    await this.archiveBatchRepo.manager.transaction(async (manager) => {
      const savedBatch = await manager.save(batch);

      files.forEach((file, index) => {
        file.batch = savedBatch;
        file.leafIndex = index;
      });

      await manager.save(files);
    });

    this.logger.info(`Anchored batch ${batch.id} over ${files.length} file(s), root ${batch.merkleRoot}`);

    return batch;
  }

  /**
   * Try to upgrade every pending batch's OpenTimestamps proof towards a Bitcoin attestation.
   *
   * The upgraded `.ots` bytes are persisted whenever the proof changed at all (e.g. it now
   * carries additional calendar commitments but `verify` still reports pending) so that
   * progress is never thrown away. `bitcoinHeight`/`status = confirmed` are set additionally
   * only once `verify` reports a Bitcoin attestation.
   */
  async upgradeBatches(): Promise<void> {
    const batches = await this.archiveBatchRepo.findBy({ status: ArchiveBatchStatus.PENDING_BTC });

    for (const batch of batches) {
      if (!batch.otsProof) continue;

      const rootBuffer = Buffer.from(batch.merkleRoot, 'hex');
      const originalProof = batch.otsProof;
      const upgraded = await this.ots.upgrade(Buffer.from(originalProof, 'base64'));
      const upgradedProof = upgraded.toString('base64');
      const result = await this.ots.verify(rootBuffer, upgraded);

      const proofChanged = upgradedProof !== originalProof;
      if (!proofChanged && !result.confirmed) continue;

      // Always persist progress when the proof bytes changed; confirm only on a real attestation.
      if (proofChanged) batch.otsProof = upgradedProof;

      if (result.confirmed) {
        batch.bitcoinHeight = result.bitcoin.height;
        batch.status = ArchiveBatchStatus.CONFIRMED;
      }

      await this.archiveBatchRepo.save(batch);

      if (result.confirmed) {
        this.logger.info(`Confirmed batch ${batch.id} at Bitcoin height ${batch.bitcoinHeight}`);
      } else {
        this.logger.info(`Upgraded pending OpenTimestamps proof for batch ${batch.id}`);
      }
    }
  }

  /**
   * Verify a supplied document against its archived, anchored Merkle batch end-to-end:
   * recompute its SHA-256, compare with the stored hash, rebuild the inclusion proof against
   * the batch's Merkle root, and check the OpenTimestamps attestation status.
   */
  async verifyDocument(bucket: string, name: string, data: Buffer): Promise<ArchiveVerification> {
    const file = await this.archiveFileRepo.findOne({ where: { bucket, name }, relations: ['batch'] });
    if (!file) return { found: false };

    const computedHex = sha256(data).toString('hex');
    const hashMatches = file.sha256 === computedHex;

    const batch = file.batch;
    if (!batch) return { found: true, hashMatches, anchored: false };

    const batchFiles = await this.archiveFileRepo.find({
      where: { batch: { id: batch.id } },
      order: { leafIndex: 'ASC' },
    });
    const leaves = batchFiles.map((batchFile) => Buffer.from(batchFile.sha256, 'hex'));

    const rootBuffer = Buffer.from(batch.merkleRoot, 'hex');
    const proof = merkleInclusionProof(leaves, file.leafIndex);
    const proofValid = verifyMerkleProof(Buffer.from(file.sha256, 'hex'), proof, rootBuffer);

    let bitcoinHeight: number;
    let pending = true;

    if (batch.otsProof) {
      const ots = await this.ots.verify(rootBuffer, Buffer.from(batch.otsProof, 'base64'));
      pending = ots.pending;
      if (ots.bitcoin) bitcoinHeight = ots.bitcoin.height;
    }

    return { found: true, hashMatches, anchored: true, proofValid, bitcoinHeight, pending };
  }
}
