import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

@Entity()
export class BankData extends IEntity {
  @Column({ length: 256 })
  name: string;

  @Column({ nullable: true })
  active: boolean;

  @Column({ length: 256 })
  @Index({ unique: true, where: 'active = 1' })
  iban: string;

  @ManyToOne(() => UserData, { nullable: false })
  userData: UserData;
}
