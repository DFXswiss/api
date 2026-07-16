import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { IsNull } from 'typeorm';
import { ArchiveBatch, ArchiveBatchStatus } from './archive-batch.entity';
import { ArchiveBatchRepository } from './archive-batch.repository';
import { ArchiveFile } from './archive-file.entity';
import { ArchiveFileRepository } from './archive-file.repository';
import { serializeMerkleProof } from './merkle-proof-codec';
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
   * A new `(bucket, name)` is inserted as a fresh, unanchored row. An EXISTING row's `sha256` is
   * NEVER mutated in place, whether or not it has been assigned to a Merkle batch: an identical
   * hash is a no-op (idempotent), a differing hash is refused — logged (before → after, for audit)
   * and rejected with a hard error — rather than silently applied. This is a deliberate
   * "auditable mutation, no destructive overwrite" design (CONTRIBUTING.md): a re-upload/re-hash
   * of the same `(bucket, name)` must never silently replace what was previously recorded, whether
   * that record is already Merkle-anchored (where it would falsify {@link verifyDocument}) or not
   * yet anchored (where it would erase evidence of the earlier, differing content without a
   * trace).
   *
   * Because recordHash never writes to an existing row, there is nothing left for a concurrent
   * {@link anchorPending} to race against here: anchorPending's own per-file conditional update
   * likewise never touches `sha256` (see there). TOCTOU-safety therefore falls out of both
   * functions simply never overwriting this column on an existing row, rather than out of a
   * conditional-write/reload dance.
   */
  async recordHash(bucket: string, name: string, sha256Hex: string): Promise<void> {
    const existing = await this.archiveFileRepo.findOne({ where: { bucket, name }, relations: { batch: true } });

    if (existing) {
      if (existing.sha256 === sha256Hex) return;

      if (existing.batch != null) {
        const message =
          `Refusing to overwrite anchored hash for ${bucket}/${name} (file ${existing.id}, batch ` +
          `${existing.batch.id}): stored ${existing.sha256} differs from new ${sha256Hex}`;
        this.logger.error(message);
        throw new Error(message);
      }

      const message =
        `Refusing to overwrite unanchored hash for ${bucket}/${name} (file ${existing.id}): ` +
        `stored ${existing.sha256} differs from new ${sha256Hex}`;
      this.logger.warn(message);
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
    const files = await this.archiveFileRepo.find({ where: { bucket }, select: { name: true } });
    return new Set(files.map((file) => file.name));
  }

  /**
   * Batch all currently unanchored files (ordered by id) into one Merkle tree, timestamp its
   * root via OpenTimestamps, and persist batch + per-file assignment (including each file's
   * inclusion proof) in a single transaction.
   *
   * Each file's assignment is written via a conditional UPDATE keyed on `id`, `batch IS NULL`,
   * AND the exact `sha256` read when the files were selected above (T0). If a concurrent
   * {@link recordHash} call is refused in between (or, more generally, if the row no longer
   * matches its T0 snapshot for any reason), the conditional update simply affects 0 rows for
   * that file: it is skipped (left `batch IS NULL`, picked up again on the next anchoring cycle)
   * rather than being claimed into a batch whose committed leaf may no longer correspond to the
   * row's current content. This update only ever sets `batch` / `leafIndex` / `merkleProof` — it
   * never writes `sha256`, so it can never destructively race against recordHash either.
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

    let anchoredCount = 0;

    await this.archiveBatchRepo.manager.transaction(async (manager) => {
      const savedBatch = await manager.save(batch);

      for (const [index, file] of files.entries()) {
        const result = await manager.update(
          ArchiveFile,
          { id: file.id, batch: IsNull(), sha256: file.sha256 },
          { batch: savedBatch, leafIndex: index, merkleProof: serializeMerkleProof(merkleInclusionProof(leaves, index)) },
        );

        if (result.affected) {
          anchoredCount++;
        } else {
          this.logger.warn(
            `Skipped anchoring archive file ${file.id} (${file.bucket}/${file.name}) into batch ${savedBatch.id}: ` +
              `its hash changed or it was reassigned between batching and commit (TOCTOU). It remains unanchored ` +
              `and will be picked up by the next anchoring cycle.`,
          );
        }
      }
    });

    this.logger.info(`Anchored batch ${batch.id} over ${anchoredCount}/${files.length} file(s), root ${batch.merkleRoot}`);

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
    const file = await this.archiveFileRepo.findOne({ where: { bucket, name }, relations: { batch: true } });
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
    const proof = file.merkleProofSteps;
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
