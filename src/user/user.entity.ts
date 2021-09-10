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
  KYC = 'KYC',
}

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 256 })
  ref: string;

  @Column({ type: 'varchar', length: 256, unique: true })
  address: string;

  @Column({ type: 'varchar', unique: true, length: 256 })
  signature: string;

  @ManyToOne(() => Wallet, { eager: false, lazy: true })
  @JoinColumn()
  wallet: Wallet;

  @Column({ type: 'varchar', default: '000-000', length: 256 })
  usedRef: string;

  @Column({ type: 'varchar', length: 256, default: null, nullable: true })
  mail: string;

  @Column({ type: 'varchar', length: 256, default: null, nullable: true })
  firstname: string;

  @Column({ type: 'varchar', length: 256, default: null, nullable: true })
  surname: string;

  @Column({ type: 'varchar', length: 256, default: null, nullable: true })
  street: string;

  @Column({ type: 'varchar', length: 256, default: null, nullable: true })
  houseNumber: string;

  @Column({ type: 'varchar', length: 256, default: null, nullable: true })
  location: string;

  @Column({ type: 'varchar', length: 256, default: null, nullable: true })
  zip: string;

  @ManyToOne(() => Country, { eager: true })
  @JoinColumn()
  country: Country;

  @Column({ type: 'varchar', length: 256, default: null, nullable: true })
  phone: string;

  @ManyToOne(() => Language, { eager: true })
  @JoinColumn()
  language: Language;

  @Column({ type: 'varchar', default: UserRole.USER, length: 256 })
  role: UserRole;

  @Column({ type: 'varchar', default: UserStatus.NA, length: 256 })
  status: UserStatus;

  @Column({ type: 'varchar', default: '0.0.0.0', length: 256 })
  ip: string;

  @OneToMany(() => Buy, (buy) => buy.user, { lazy: true })
  @JoinColumn()
  buys: Buy[];

  @OneToMany(() => Sell, (sell) => sell.user, { lazy: true })
  @JoinColumn()
  sells: Sell[];

  @ManyToOne(() => UserData, { cascade: ["insert"], lazy: true })
  @JoinColumn()
  userData: UserData;

  @OneToMany(() => Log, (logs) => logs.user,{ lazy: true})
  logs: Log[];

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
