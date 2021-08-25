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

export enum UserDataNameCheck {
  NA = 'NA',
  SAVE = 'Save person',
  WARNING = 'Warning person',
  HIGHRISK = 'High-risk person',
}

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

  @Column({ type: 'varchar', length: 256, default: UserDataNameCheck.NA })
  nameCheck: UserDataNameCheck;

  @OneToMany(() => User, (user) => user.userData)
  users: User[];

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
