import { Column, Entity, Index, Unique } from 'typeorm';
import { IEntity } from '../../../../shared/models/entity';

export enum VirtualIbanIssuanceIntentStatus {
  PENDING = 'Pending',
  ISSUING = 'Issuing',
  COMPLETED = 'Completed',
  FAILED = 'Failed',
}

@Entity()
@Unique('UQ_virtual_iban_issuance_intent_user_currency_bank', ['userDataId', 'currencyId', 'bankId'])
export class VirtualIbanIssuanceIntent extends IEntity {
  /** Non-PII technical reference used as Bank Frick `description` for crash recovery. */
  @Index('UQ_virtual_iban_issuance_intent_requestReference', { unique: true })
  @Column({ length: 64 })
  requestReference: string;

  @Index('IDX_virtual_iban_issuance_intent_userDataId')
  @Column({ type: 'integer' })
  userDataId: number;

  @Index('IDX_virtual_iban_issuance_intent_currencyId')
  @Column({ type: 'integer' })
  currencyId: number;

  @Index('IDX_virtual_iban_issuance_intent_bankId')
  @Column({ type: 'integer' })
  bankId: number;

  @Column({ length: 32 })
  status: VirtualIbanIssuanceIntentStatus;

  @Column({ length: 34, nullable: true })
  externalIban?: string;

  @Column({ type: 'text', nullable: true })
  error?: string;
}
