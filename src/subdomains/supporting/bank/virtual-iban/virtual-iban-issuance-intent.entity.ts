import { Column, Entity, Index } from 'typeorm';
import { IEntity } from '../../../../shared/models/entity';

export enum VirtualIbanIssuanceIntentStatus {
  PENDING = 'Pending',
  IN_FLIGHT = 'InFlight',
  COMPLETED = 'Completed',
  FAILED = 'Failed',
}

@Entity()
@Index((intent: VirtualIbanIssuanceIntent) => [intent.userDataId, intent.currencyId, intent.bankId], { unique: true })
export class VirtualIbanIssuanceIntent extends IEntity {
  /** Non-PII technical reference used as Bank Frick `description` for crash recovery. */
  @Column({ length: 64, unique: true })
  requestReference: string;

  @Index()
  @Column({ type: 'integer' })
  userDataId: number;

  @Index()
  @Column({ type: 'integer' })
  currencyId: number;

  @Index()
  @Column({ type: 'integer' })
  bankId: number;

  @Column({ length: 32 })
  status: VirtualIbanIssuanceIntentStatus;

  @Column({ length: 34, nullable: true })
  externalIban: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;
}
