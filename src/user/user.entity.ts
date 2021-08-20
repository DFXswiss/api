import { Buy } from 'src/buy/buy.entity';
import { Country } from 'src/country/country.entity';
import { Language } from 'src/language/language.entity';
import { Log } from 'src/log/log.entity';
import { Sell } from 'src/sell/sell.entity';
import { UserData } from 'src/userData/userData.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

export enum UserRole {
  USER = 'User',
  ADMIN = 'Admin',
  EMPLOYEE = 'Employee',
  VIP = 'VIP',
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

  @Column({ type: 'varchar' })
  ref: string;

  //TODO Varchar Längen nochmal überprüfen => nachher nicht änderbar => lieber auf 100 setzen und über dto limitieren?

  @Column({ type: 'varchar', length: 42, unique: true })
  address: string;

  @Column({ type: 'varchar', unique: true, length: 88 })
  signature: string;

  @Column({ type: 'int', default: 0 })
  walletId: number;

  @Column({ type: 'varchar', default: '000-000' })
  usedRef: string;

  @Column({ type: 'varchar', length: 64, default: null, nullable: true })
  mail: string;

  @Column({ type: 'varchar', length: 64, default: null, nullable: true })
  firstname: string;

  @Column({ type: 'varchar', length: 64, default: null, nullable: true })
  surname: string;

  @Column({ type: 'varchar', length: 64, default: null, nullable: true })
  street: string;

  @Column({ type: 'varchar', length: 5, default: null, nullable: true })
  houseNumber: string;

  @Column({ type: 'varchar', length: 64, default: null, nullable: true })
  location: string;

  @Column({ type: 'varchar', length: 9, default: null, nullable: true })
  zip: string;

  @ManyToOne(() => Country, { eager: true })
  @JoinColumn()
  country: Country;

  @Column({ type: 'varchar', length: 15, default: null, nullable: true })
  phone: string;

  @ManyToOne(() => Language, { eager: true })
  @JoinColumn()
  language: Language;

  @Column({ type: 'varchar', default: UserRole.USER })
  role: UserRole;

  @Column({ type: 'varchar', default: UserStatus.NA })
  status: UserStatus;

  @Column({ type: 'varchar', default: '0.0.0.0' })
  ip: string;

  @CreateDateColumn()
  created: Date;

  @OneToMany(() => Buy, (buy) => buy.user, { eager: true })
  @JoinColumn()
  buys: Buy[];

  @OneToMany(() => Sell, (sell) => sell.user, { eager: true })
  @JoinColumn()
  sells: Sell[];

  @ManyToOne(() => UserData, { eager: false })
  @JoinColumn()
  userData: UserData;

  @OneToMany(() => Log, (logs) => logs.user)
  logs: Log[]
}
