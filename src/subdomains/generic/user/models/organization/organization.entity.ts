import { Country } from 'src/shared/models/country/country.entity';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne, OneToMany } from 'typeorm';
import { UserData } from '../user-data/user-data.entity';

@Entity()
export class Organization extends IEntity {
  @Column({ length: 256, nullable: true })
  name?: string;

  @Column({ length: 256, nullable: true })
  street?: string;

  @Column({ length: 256, nullable: true })
  houseNumber?: string;

  @Column({ length: 256, nullable: true })
  location?: string;

  @Column({ length: 256, nullable: true })
  zip?: string;

  @ManyToOne(() => Country, { eager: true, nullable: true })
  country?: Country;

  @OneToMany(() => UserData, (userData) => userData.organization)
  userDatas: UserData[];
}
