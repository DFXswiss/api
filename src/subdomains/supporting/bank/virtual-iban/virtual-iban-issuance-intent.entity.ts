import { Column, Entity, Index } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { VirtualIbanIssuanceIntentStatus } from './virtual-iban-issuance-intent-status.enum';

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

  @Column({ type: 'varchar', length: 256 })
  provider: IbanBankName;

  /** Immutable reference-account configuration captured when the intent is first created. */
  @Column({ length: 34 })
  referenceAccountIban: string;

  @Column({ type: 'boolean' })
  referenceAccountReceive: boolean;

  @Index()
  @Column({ type: 'integer', nullable: true })
  buyId: number | null;

  // Explicit type because imported enums otherwise depend on emitDecoratorMetadata at runtime.
  @Column({ type: 'varchar', length: 32 })
  status: VirtualIbanIssuanceIntentStatus;

  @Column({ length: 34, nullable: true })
  externalIban: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;
}
