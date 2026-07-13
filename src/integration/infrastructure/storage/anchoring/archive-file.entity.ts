import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { ArchiveBatch } from './archive-batch.entity';

/**
 * A single archived storage object whose content hash participates in the GeBüV anchoring
 * pipeline. Each file is identified uniquely by its `(bucket, name)` location and records
 * the SHA-256 of its content. Once anchored, it points to its {@link ArchiveBatch} and
 * carries its `leafIndex` within that batch's Merkle tree (needed to rebuild the inclusion
 * proof during verification).
 */
@Entity()
@Index((file: ArchiveFile) => [file.bucket, file.name], { unique: true })
export class ArchiveFile extends IEntity {
  @Column({ length: 256 })
  bucket: string;

  @Column({ length: 256 })
  name: string;

  @Column({ length: 64 })
  sha256: string;

  @Index()
  @ManyToOne(() => ArchiveBatch, (batch) => batch.files, { nullable: true })
  batch?: ArchiveBatch;

  @Column({ type: 'int', nullable: true })
  leafIndex?: number;
}
