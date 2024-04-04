import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

export enum BankDataType {
  IDENT = 'Ident',
  BANK_IN = 'BankIn',
  BANK_OUT = 'BankOut',
  CARD_IN = 'CardIn',
  USER = 'User',
}

@Entity()
export class BankData extends IEntity {
  @Column({ length: 256, nullable: true })
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
