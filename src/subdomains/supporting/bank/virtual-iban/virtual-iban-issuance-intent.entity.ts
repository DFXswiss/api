import { Column, Entity, Index } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';

export enum VirtualIbanIssuanceIntentStatus {
  PENDING = 'Pending',
  IN_FLIGHT = 'InFlight',
  COMPLETED = 'Completed',
  FAILED = 'Failed',
}

@Entity()
@Index((intent: VirtualIbanIssuanceIntent) => [intent.userDataId, intent.currencyId, intent.bankId], {
  unique: true,
  where: '"buyId" IS NULL',
})
@Index((intent: VirtualIbanIssuanceIntent) => [intent.buyId, intent.currencyId, intent.bankId], {
  unique: true,
  where: '"buyId" IS NOT NULL',
})
export class VirtualIbanIssuanceIntent extends IEntity {
  /** Non-PII claim reference; Bank Frick also uses it as its recoverable `description`. */
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

  @Column({ type: 'varchar', length: 256, default: IbanBankName.FRICK })
  provider: IbanBankName = IbanBankName.FRICK;

  @Index()
  @Column({ type: 'integer', nullable: true })
  buyId: number | null;

  // Explicit type even though the enum is same-file today: keeps the column independent of
  // emitDecoratorMetadata if the enum is ever moved (same trap as previousStatus/nextStatus).
  @Column({ type: 'varchar', length: 32 })
  status: VirtualIbanIssuanceIntentStatus;

  @Column({ length: 34, nullable: true })
  externalIban: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;
}
