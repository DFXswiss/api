import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { ArchiveBatch } from './archive-batch.entity';
import { deserializeMerkleProof, serializeMerkleProof } from './merkle-proof-codec';
import { MerkleProofStep } from './merkle';

/**
 * A single archived storage object whose content hash participates in the GeBüV anchoring
 * pipeline. Each file is identified uniquely by its `(bucket, name)` location and records
 * the SHA-256 of its content. Once anchored, it points to its {@link ArchiveBatch} and
 * carries its `leafIndex` within that batch's Merkle tree plus a persisted inclusion proof
 * so verification does not depend on sibling rows remaining available.
 */
@Entity()
@Index((file: ArchiveFile) => [file.bucket, file.name], { unique: true })
export class ArchiveFile extends IEntity {
  @Column({ type: 'text' })
  bucket: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ length: 64 })
  sha256: string;

  @Index()
  @ManyToOne(() => ArchiveBatch, (batch) => batch.files, { nullable: true })
  batch?: ArchiveBatch;

  @Column({ type: 'int', nullable: true })
  leafIndex?: number;

  /**
   * JSON-serialized inclusion proof (`MerkleProofStep[]`, siblings hex-encoded), populated
   * from `merkleInclusionProof` at anchor time. Persisted so an old file stays verifiable
   * even if sibling rows in the same batch are later lost or corrupted. Raw JSON string column —
   * business logic should go through the typed `merkleProofSteps` getter/setter below, never
   * parse/stringify this directly.
   */
  @Column({ type: 'text', nullable: true })
  merkleProof?: string;

  get merkleProofSteps(): MerkleProofStep[] | undefined {
    return this.merkleProof ? deserializeMerkleProof(this.merkleProof) : undefined;
  }

  set merkleProofSteps(steps: MerkleProofStep[] | undefined) {
    this.merkleProof = steps ? serializeMerkleProof(steps) : undefined;
  }
}
