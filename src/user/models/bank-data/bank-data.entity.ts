import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/user/models/user-data/user-data.entity';
import { Entity, Column, Index, ManyToOne } from 'typeorm';

@Entity()
@Index('nameLocationIban', (bankData: BankData) => [bankData.name, bankData.location, bankData.iban], { unique: true })
export class BankData extends IEntity {
  @Column({ length: 256 })
  name: string;

  @Column({ length: 256, nullable: true })
  location: string;

  @Column({ length: 256, nullable: true })
  country: string;

  @Column({ length: 256 })
  iban: string;

  @Column({ length: 256, nullable: true })
  bankName: string;

  @Column({ length: 256, nullable: true })
  bic: string;

  @ManyToOne(() => UserData)
  userData: UserData;
}
