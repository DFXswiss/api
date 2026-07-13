import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, OneToMany } from 'typeorm';
import { ArchiveFile } from './archive-file.entity';

/** Lifecycle of an anchoring batch on the way to a Bitcoin attestation. */
export enum ArchiveBatchStatus {
  PENDING_BTC = 'pendingBtc',
  CONFIRMED = 'confirmed',
}

/**
 * A daily (or on-demand) Merkle batch over a set of {@link ArchiveFile} hashes for the
 * GeBüV anchoring pipeline. The `merkleRoot` is timestamped via OpenTimestamps; the
 * resulting detached `.ots` proof is persisted (base64) in `otsProof` and upgraded over
 * time until it carries a Bitcoin attestation (`bitcoinHeight` set, `status` confirmed).
 */
@Entity()
export class ArchiveBatch extends IEntity {
  @Column({ length: 64 })
  merkleRoot: string;

  @Column({ type: 'text', nullable: true })
  otsProof?: string;

  @Column({ type: 'int', nullable: true })
  bitcoinHeight?: number;

  @Column({ length: 256, default: ArchiveBatchStatus.PENDING_BTC })
  status: ArchiveBatchStatus;

  @OneToMany(() => ArchiveFile, (file) => file.batch)
  files: ArchiveFile[];
}
