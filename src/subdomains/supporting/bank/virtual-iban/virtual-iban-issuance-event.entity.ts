import { Column, Entity, Index } from 'typeorm';
import { IEntity } from '../../../../shared/models/entity';
import { VirtualIbanIssuanceIntentStatus } from './virtual-iban-issuance-intent.entity';

/**
 * Append-only audit record written before every issuance-intent snapshot transition.
 * `previousVirtualIbanId` / `nextVirtualIbanId` reference `VirtualIban.id` by convention only
 * (no enforced FK) so migration stays safe on production tables that may lack primary keys.
 */
@Entity()
export class VirtualIbanIssuanceEvent extends IEntity {
  @Index()
  @Column({ type: 'integer' })
  intentId: number;

  @Column({ type: 'integer' })
  userDataId: number;

  @Column({ type: 'integer' })
  currencyId: number;

  @Column({ type: 'integer' })
  bankId: number;

  // Explicit type: Enum is imported cross-file; ts-jest transpile-only (isolatedModules) cannot
  // reliably emit design:type for that import and would otherwise leave Object → Postgres crash.
  @Column({ type: 'varchar', length: 32 })
  previousStatus: VirtualIbanIssuanceIntentStatus;

  @Column({ type: 'varchar', length: 32 })
  nextStatus: VirtualIbanIssuanceIntentStatus;

  @Column({ type: 'integer', nullable: true })
  previousVirtualIbanId: number | null;

  @Column({ type: 'integer', nullable: true })
  nextVirtualIbanId: number | null;

  @Column({ type: 'text', nullable: true })
  previousError: string | null;

  @Column({ type: 'text', nullable: true })
  nextError: string | null;
}
