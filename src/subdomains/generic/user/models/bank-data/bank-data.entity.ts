import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

export enum BankDataType {
  IDENT = 'Ident',
  BANK_TX_INP = 'BankTxInp',
  BANK_TX_OUT = 'BankTxOut',
  CREDIT_CARD_INP = 'CreditCardInp',
}

@Entity()
export class BankData extends IEntity {
  @Column({ length: 256 })
  name: string;

  @Column({ nullable: true })
  active: boolean;

  @Column({ length: 256 })
  @Index({ unique: true, where: 'active = 1' })
  iban: string;

  @Column({ length: 256, nullable: true })
  type: BankDataType;

  @ManyToOne(() => UserData, { nullable: false })
  userData: UserData;
}
