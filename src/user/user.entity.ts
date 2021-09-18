import { Buy } from 'src/buy/buy.entity';
import { Country } from 'src/country/country.entity';
import { Language } from 'src/language/language.entity';
import { Log } from 'src/log/log.entity';
import { Sell } from 'src/sell/sell.entity';
import { UserData } from 'src/userData/userData.entity';
import { Wallet } from 'src/wallet/wallet.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum UserRole {
  USER = 'User',
  ADMIN = 'Admin',
  EMPLOYEE = 'Employee',
  VIP = 'VIP',
  SUPPORT = 'SUPPORT',
}

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

  @ManyToOne(() => Wallet, { lazy: true })
  @JoinColumn()
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
  @JoinColumn()
  country: Country;

  @Column({ length: 256, nullable: true })
  phone: string;

  @ManyToOne(() => Language, { eager: true })
  @JoinColumn()
  language: Language;

  @Column({ default: UserRole.USER, length: 256 })
  role: UserRole;

  @Column({ default: UserStatus.NA, length: 256 })
  status: UserStatus;

  @Column({ default: '0.0.0.0', length: 256 })
  ip: string;

  @OneToMany(() => Buy, (buy) => buy.user, { lazy: true })
  @JoinColumn()
  buys: Buy[];

  @OneToMany(() => Sell, (sell) => sell.user, { lazy: true })
  @JoinColumn()
  sells: Sell[];

  @ManyToOne(() => UserData)
  @JoinColumn()
  userData: UserData;

  @OneToMany(() => Log, (logs) => logs.user, { lazy: true })
  logs: Log[];

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
