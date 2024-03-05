import { IEntity } from 'src/shared/models/entity';
import { Column, Entity } from 'typeorm';

export enum SpecialExternalBankAccountType {
  MULTI_ACCOUNT_IBAN = 'MultiAccountIban',
  BANNED_IBAN = 'BannedIban',
  BANNED_BIC = 'BannedBic',
}

@Entity()
export class SpecialExternalBankAccount extends IEntity {
  @Column({ length: 256 })
  type: SpecialExternalBankAccountType;

  @Column({ length: 256, nullable: true })
  name: string;

  @Column({ length: 256, nullable: true })
  iban: string;

  @Column({ length: 256, nullable: true })
  bic: string;

  @Column({ length: 256, nullable: true })
  comment: string;
}
