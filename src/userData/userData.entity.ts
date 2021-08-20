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

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar' })
  location: string;

  @ManyToOne(() => Country, { eager: true })
  @JoinColumn()
  country: Country;

  @CreateDateColumn()
  created: Date;

  @OneToMany(() => User, (user) => user.userData)
  users: User[];
}
