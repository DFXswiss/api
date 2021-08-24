import { Country } from 'src/country/country.entity';
import { User } from 'src/user/user.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
@Index(
  'nameLocation',
  (userData: UserData) => [userData.name, userData.location],
  { unique: true },
)
export class UserData {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 256 })
  name: string;

  @Column({ type: 'varchar', length: 256 })
  location: string;

  @ManyToOne(() => Country, { eager: true })
  @JoinColumn()
  country: Country;

  @OneToMany(() => User, (user) => user.userData)
  users: User[];

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
