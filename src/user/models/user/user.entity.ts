import { Buy } from 'src/user/models/buy/buy.entity';
import { Country } from 'src/shared/models/country/country.entity';
import { Language } from 'src/shared/models/language/language.entity';
import { Log } from 'src/user/models/log/log.entity';
import { Sell } from 'src/user/models/sell/sell.entity';
import { UserData } from 'src/user/models/userData/userData.entity';
import { Wallet } from 'src/user/models/wallet/wallet.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  ManyToOne,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { AnyRecord } from 'dns';

export enum UserStatus {
  NA = 'NA',
  ACTIVE = 'Active',
  VERIFY = 'Verified',
}

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 256 })
  ref: string;

  @Column({ length: 256, unique: true })
  address: string;

  @Column({ unique: true, length: 256 })
  signature: string;

  @ManyToOne(() => Wallet)
  wallet: Wallet;

  @Column({ default: '000-000', length: 256 })
  usedRef: string;

  @Column({ length: 256, nullable: true })
  mail: string;

  @Column({ length: 256, nullable: true })
  firstname: string;

  @Column({ length: 256, nullable: true })
  surname: string;

  @Column({ length: 256, nullable: true })
  street: string;

  @Column({ length: 256, nullable: true })
  houseNumber: string;

  @Column({ length: 256, nullable: true })
  location: string;

  @Column({ length: 256, nullable: true })
  zip: string;

  @ManyToOne(() => Country, { eager: true })
  country: Country;

  @ManyToOne(() => Fiat, { eager: true })
  currency: Fiat;

  @Column({ length: 256, nullable: true })
  phone: string;

  @ManyToOne(() => Language, { eager: true })
  language: Language;

  @Column({ default: UserRole.USER, length: 256 })
  role: UserRole;

  @Column({ default: UserStatus.NA, length: 256 })
  status: UserStatus;

  @Column({ default: '0.0.0.0', length: 256 })
  ip: string;

  @OneToMany(() => Buy, (buy) => buy.user)
  buys: Buy[];

  @OneToMany(() => Sell, (sell) => sell.user)
  sells: Sell[];

  @ManyToOne(() => UserData)
  userData: UserData;

  @OneToMany(() => Log, (logs) => logs.user)
  logs: Log[];

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
  currentUser: Promise<any>;
}
