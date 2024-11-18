import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, Index, ManyToOne, OneToMany } from 'typeorm';

export enum BankDataType {
  IDENT = 'Ident',
  BANK_IN = 'BankIn',
  BANK_OUT = 'BankOut',
  CARD_IN = 'CardIn',
  USER = 'User',
}

export enum BankDataVerificationError {
  USER_DATA_NOT_MATCHING = 'UserDataNotMatching',
  NAME_MISSING = 'NameMissing',
  VERIFIED_NAME_MISSING = 'VerifiedNameMissing',
  VERIFIED_NAME_NOT_MATCHING = 'VerifiedNameNotMatching',
  ALREADY_ACTIVE_EXISTS = 'AlreadyActiveExists',
  NEW_BANK_IN_ACTIVE = 'NewBankInActive',
}

@Entity()
@Index((bankData: BankData) => [bankData.iban, bankData.userData], {
  unique: true,
  where: `type = '${BankDataType.USER}'`,
})
export class BankData extends IEntity {
  @Column({ length: 256, nullable: true })
  name: string;

  @Column({ nullable: true })
  approved: boolean;

  @Column({ length: 256 })
  @Index({ unique: true, where: 'approved = 1' })
  iban: string;

  @Column({ length: 256, nullable: true })
  type: BankDataType;

  @Column({ length: 'MAX', nullable: true })
  comment: string;

  @Column({ nullable: true })
  manualApproved: boolean;

  @Column({ length: 256, nullable: true })
  label: string;

  @ManyToOne(() => Fiat, { nullable: true, eager: true })
  preferredCurrency: Fiat;

  @ManyToOne(() => UserData, { nullable: false })
  userData: UserData;

  @OneToMany(() => Sell, (sell) => sell.bankData)
  sells: Sell[];

  // --- ENTITY METHODS --- //

  activate(): UpdateResult<BankData> {
    const update: Partial<BankData> = {
      approved: true,
      comment: 'Pass',
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  deactivate(comment?: string): UpdateResult<BankData> {
    const update: Partial<BankData> = {
      approved: false,
      comment,
    };

    Object.assign(this, update);

    return [this.id, update];
  }
}
