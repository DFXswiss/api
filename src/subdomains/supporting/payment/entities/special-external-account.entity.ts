import { IEntity } from 'src/shared/models/entity';
import { Column, Entity } from 'typeorm';

export enum SpecialExternalAccountType {
  MULTI_ACCOUNT_IBAN = 'MultiAccountIban',
  BANNED_IBAN = 'BannedIban',
  BANNED_IBAN_BUY = 'BannedIbanBuy',
  BANNED_IBAN_SELL = 'BannedIbanSell',
  BANNED_BIC = 'BannedBic',
  BANNED_MAIL = 'BannedMail',
}

@Entity()
export class SpecialExternalAccount extends IEntity {
  @Column({ length: 256 })
  type: SpecialExternalAccountType;

  @Column({ length: 256, nullable: true })
  name: string;

  @Column({ length: 256, nullable: true })
  value: string;

  @Column({ length: 256, nullable: true })
  comment: string;

  // --- ENTITY METHODS --- //

  matches(type: SpecialExternalAccountType, value: string): boolean {
    return this.type === type && new RegExp(this.value).test(value);
  }
}
