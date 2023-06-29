import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

@Entity()
@Index('nameLocationIban', (bankData: BankData) => [bankData.name, bankData.iban], { unique: true })
export class BankData extends IEntity {
  @Column({ length: 256 })
  name: string;

  @Column({ default: true })
  active: boolean;

  @Column({ length: 256 })
  iban: string;

  @ManyToOne(() => UserData, { nullable: false })
  userData: UserData;
}
