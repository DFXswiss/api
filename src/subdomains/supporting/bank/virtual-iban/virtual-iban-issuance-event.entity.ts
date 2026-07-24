import { Column, Entity, Index } from 'typeorm';
import { IEntity } from '../../../../shared/models/entity';
import { VirtualIbanIssuanceIntentStatus } from './virtual-iban-issuance-intent.entity';

/** Append-only audit record written before every issuance-intent snapshot transition. */
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

  @Column({ length: 32 })
  previousStatus: VirtualIbanIssuanceIntentStatus;

  @Column({ length: 32 })
  nextStatus: VirtualIbanIssuanceIntentStatus;

  @Column({ length: 34, nullable: true })
  previousExternalIban: string | null;

  @Column({ length: 34, nullable: true })
  nextExternalIban: string | null;

  @Column({ type: 'text', nullable: true })
  previousError: string | null;

  @Column({ type: 'text', nullable: true })
  nextError: string | null;
}
