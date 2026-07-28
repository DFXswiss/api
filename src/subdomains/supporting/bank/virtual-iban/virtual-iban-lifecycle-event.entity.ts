import { Column, Entity, Index } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';
import { VirtualIbanStatus } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.entity';

/**
 * Append-only audit record written before a VirtualIban lifecycle or ownership snapshot mutation.
 * Scalar IDs deliberately have no foreign keys so legacy production tables without primary keys
 * remain migration-compatible.
 */
@Entity()
export class VirtualIbanLifecycleEvent extends IEntity {
  @Index()
  @Column({ type: 'integer' })
  virtualIbanId: number;

  @Column({ type: 'integer' })
  previousUserDataId: number;

  @Column({ type: 'integer' })
  nextUserDataId: number;

  @Column({ type: 'boolean' })
  previousActive: boolean;

  @Column({ type: 'boolean' })
  nextActive: boolean;

  @Column({ type: 'varchar', length: 256, nullable: true })
  previousStatus: VirtualIbanStatus | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  nextStatus: VirtualIbanStatus | null;

  @Column({ type: 'timestamp', nullable: true })
  previousDeactivatedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  nextDeactivatedAt: Date | null;

  @Column({ type: 'timestamp' })
  transitionedAt: Date;

  @Column({ type: 'text' })
  reason: string;
}
