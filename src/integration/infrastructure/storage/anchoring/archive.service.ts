import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { IsNull } from 'typeorm';
import { ArchiveBatch, ArchiveBatchStatus } from './archive-batch.entity';
import { ArchiveBatchRepository } from './archive-batch.repository';
import { ArchiveFileRepository } from './archive-file.repository';
import { deserializeMerkleProof, serializeMerkleProof } from './merkle-proof-codec';
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
  /**
   * true iff found && hashMatches && anchored && proofValid (all four independently true).
   * Independent of `pending`: a calendar-only (not yet Bitcoin-confirmed) proof can still
   * be fully verified against its Merkle root.
   */
  verified: boolean;
  /** Bitcoin block height of the OpenTimestamps attestation, once anchored on-chain. */
  bitcoinHeight?: number;
  /**
   * true while the OpenTimestamps proof is still calendar-only (not yet on-chain).
   * Independent of `verified` — pending does not mean unverified.
   */
  pending?: boolean;
}

/**
 * Stage 2 of the GeBüV anchoring pipeline: it records content hashes of archived storage
 * objects, batches the still-unanchored ones into a daily Merkle tree, timestamps the root
 * via OpenTimestamps (Stage 1 primitives), upgrades those proofs to Bitcoin attestations,
 * and verifies a given document against its anchored batch end-to-end.
 *
 * Leaves are the 32-byte SHA-256 digests of the file contents; the Merkle module
 * domain-separates them via RFC 6962 leaf hashing (`sha256(0x00 || digest)`) before they
 * enter the tree. `merkleRoot` is stored hex, `otsProof` is stored base64 of the serialized
 * detached `.ots` bytes, and each file's inclusion proof is persisted as JSON on
 * `archive_file.merkleProof`.
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
   *
   * When the row looks unanchored at read time, the update is conditional on `batch` still
   * being null at write time, so a concurrent {@link anchorPending} that claims the row
   * cannot be overwritten by a stale write (TOCTOU).
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

      // Conditional update: only write if still unanchored (closes TOCTOU with anchorPending).
      const result = await this.archiveFileRepo.update({ id: existing.id, batch: IsNull() }, { sha256: sha256Hex });
      if (result.affected !== 0) return;

      // Lost the race: a concurrent anchorPending claimed this row between read and write.
      const reloaded = await this.archiveFileRepo.findOne({ where: { id: existing.id }, relations: ['batch'] });
      if (!reloaded) {
        const message = `Archive file ${existing.id} (${bucket}/${name}) disappeared during concurrent update`;
        this.logger.error(message);
        throw new Error(message);
      }

      if (reloaded.sha256 === sha256Hex) return;

      if (reloaded.batch != null) {
        const message =
          `Refusing to overwrite anchored hash for ${bucket}/${name} (file ${reloaded.id}, batch ` +
          `${reloaded.batch.id}): concurrent anchor claimed the row; stored ${reloaded.sha256} ` +
          `differs from new ${sha256Hex}`;
        this.logger.error(message);
        throw new Error(message);
      }

      // batch still null but conditional update matched nothing — data-integrity inconsistency.
      const message =
        `Unexpected data-integrity inconsistency for ${bucket}/${name} (file ${reloaded.id}): ` +
        `conditional update affected 0 rows but file is still unanchored with differing hash ` +
        `(stored ${reloaded.sha256}, new ${sha256Hex})`;
      this.logger.error(message);
      throw new Error(message);
    }

    const file = this.archiveFileRepo.create({ bucket, name, sha256: sha256Hex });
    await this.archiveFileRepo.save(file);
  }

  /**
   * Names already present in the `(bucket, name)` archive index for a bucket, regardless of
   * anchoring status. Used by {@link ArchiveScheduler.reconcileHashes} to diff live storage
   * objects against recorded hashes and find gaps left by a failed {@link recordHash} call —
   * which, unlike a normal upload failure, leaves no row at all, so a DB-only scan can never
   * find it.
   */
  async recordedNames(bucket: string): Promise<Set<string>> {
    const files = await this.archiveFileRepo.find({ where: { bucket }, select: ['name'] });
    return new Set(files.map((file) => file.name));
  }

  /**
   * Batch all currently unanchored files (ordered by id) into one Merkle tree, timestamp its
   * root via OpenTimestamps, and persist batch + per-file assignment (including each file's
   * inclusion proof) in a single transaction.
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
        file.merkleProof = serializeMerkleProof(merkleInclusionProof(leaves, index));
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
   * recompute its SHA-256 from the supplied bytes, compare with the stored hash, verify the
   * persisted inclusion proof against the batch's Merkle root using the supplied digest as
   * the leaf, and check the OpenTimestamps attestation status.
   */
  async verifyDocument(bucket: string, name: string, data: Buffer): Promise<ArchiveVerification> {
    const file = await this.archiveFileRepo.findOne({ where: { bucket, name }, relations: ['batch'] });
    if (!file) return { found: false, verified: false };

    const computedDigest = sha256(data);
    const computedHex = computedDigest.toString('hex');
    const hashMatches = file.sha256 === computedHex;

    const batch = file.batch;
    if (!batch) return { found: true, hashMatches, anchored: false, verified: false };

    if (file.merkleProof == null || file.merkleProof === '') {
      const message =
        `Data-integrity inconsistency: archive file ${file.id} (${bucket}/${name}) is assigned ` +
        `to batch ${batch.id} but has no persisted merkleProof`;
      this.logger.error(message);
      throw new Error(message);
    }

    const rootBuffer = Buffer.from(batch.merkleRoot, 'hex');
    const proof = deserializeMerkleProof(file.merkleProof);
    // Leaf must be the digest of the SUPPLIED bytes — never the stored hash — so a
    // tampered document yields proofValid: false.
    const proofValid = verifyMerkleProof(computedDigest, proof, rootBuffer);

    let bitcoinHeight: number;
    let pending = true;

    if (batch.otsProof) {
      const ots = await this.ots.verify(rootBuffer, Buffer.from(batch.otsProof, 'base64'));
      pending = ots.pending;
      if (ots.bitcoin) bitcoinHeight = ots.bitcoin.height;
    }

    const verified = hashMatches && proofValid;
    return { found: true, hashMatches, anchored: true, proofValid, verified, bitcoinHeight, pending };
  }
}
