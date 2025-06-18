import { IEntity } from 'src/shared/models/entity';
import { Column, Entity } from 'typeorm';

export enum SpecialExternalAccountType {
  MULTI_ACCOUNT_IBAN = 'MultiAccountIban',
  MULTI_ACCOUNT_BANK_NAME = 'MultiAccountBankName',
  BANNED_IBAN = 'BannedIban',
  BANNED_IBAN_BUY = 'BannedIbanBuy',
  BANNED_IBAN_SELL = 'BannedIbanSell',
  BANNED_IBAN_AML = 'BannedIbanAml',
  BANNED_BIC = 'BannedBic',
  BANNED_BIC_BUY = 'BannedBicBuy',
  BANNED_BIC_SELL = 'BannedBicSell',
  BANNED_BIC_AML = 'BannedBicAml',
  BANNED_MAIL = 'BannedMail',
  BANNED_ACCOUNT_IBAN = 'BannedAccountIban',
}

@Entity()
export class SpecialExternalAccount extends IEntity {
  @Column({ length: 256 })
  type: SpecialExternalAccountType;

  @Column({ length: 256, nullable: true })
  name?: string;

  @Column({ length: 256, nullable: true })
  value?: string;

  @Column({ length: 256, nullable: true })
  comment?: string;

  // --- ENTITY METHODS --- //

  matches(types: SpecialExternalAccountType[], value: string): boolean {
    return types.some((t) => this.type === t) && new RegExp(this.value).test(value);
  }
}
