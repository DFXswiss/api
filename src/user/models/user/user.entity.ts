import { Buy } from 'src/payment/models/buy/buy.entity';
import { Country } from 'src/shared/models/country/country.entity';
import { Language } from 'src/shared/models/language/language.entity';
import { Log } from 'src/user/models/log/log.entity';
import { Sell } from 'src/payment/models/sell/sell.entity';
import { UserData } from 'src/user/models/userData/userData.entity';
import { Wallet } from 'src/user/models/wallet/wallet.entity';
import { Entity, Column, OneToMany, ManyToOne } from 'typeorm';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { InternalServerErrorException } from '@nestjs/common';
import { AccountType } from '../userData/account-type.enum';
import { Staking } from '../../../payment/models/staking/staking.entity';
import { IEntity } from 'src/shared/models/entity';

export enum UserStatus {
  NA = 'NA',
  ACTIVE = 'Active',
  ACTIVE_SELL = 'ActiveSell',
  VERIFY = 'Verified',
}

@Entity()
export class User extends IEntity {
  @Column({ default: AccountType.PERSONAL, length: 256 })
  accountType: AccountType;

  @Column({ length: 256 })
  ref: string;

  @Column({ type: 'float', default: 0.5 })
  refFeePercent: number;

  @Column({ type: 'float', default: 0 })
  refVolume: number;

  @Column({ type: 'float', default: 0 })
  refCredit: number;

  @Column({ type: 'float', nullable: false, default: 0 })
  paidRefCredit: number;

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

  @Column({ length: 256, nullable: true })
  organizationName: string;

  @Column({ length: 256, nullable: true })
  organizationStreet: string;

  @Column({ length: 256, nullable: true })
  organizationHouseNumber: string;

  @Column({ length: 256, nullable: true })
  organizationLocation: string;

  @Column({ length: 256, nullable: true })
  organizationZip: string;

  @ManyToOne(() => Country, { eager: true })
  organizationCountry: Country;

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

  @Column({ nullable: true, length: 'MAX' })
  cfpVotes: string;

  @OneToMany(() => Buy, (buy) => buy.user)
  buys: Buy[];

  @OneToMany(() => Sell, (sell) => sell.user)
  sells: Sell[];

  @OneToMany(() => Staking, (staking) => staking.user)
  stakingRoutes: Staking[];

  @ManyToOne(() => UserData)
  userData: UserData;

  @OneToMany(() => Log, (logs) => logs.user)
  logs: Log[];
}

export interface UserInfo {
  accountType: AccountType;
  mail: string;
  firstname: string;
  surname: string;
  street: string;
  houseNumber: string;
  location: string;
  zip: string;
  country: Country;
  organizationName: string;
  organizationStreet: string;
  organizationHouseNumber: string;
  organizationLocation: string;
  organizationZip: string;
  organizationCountry: Country;
  phone: string;
  language: Language;
}

export function getUserInfo(user: User): UserInfo {
  if (!user.userData) throw new InternalServerErrorException('User data is not defined');
  return extractUserInfo(user.userData.isMigrated ? user.userData : user);
}

export function extractUserInfo(source: UserInfo): UserInfo {
  return {
    accountType: source.accountType,
    mail: source.mail,
    firstname: source.firstname,
    surname: source.surname,
    street: source.street,
    houseNumber: source.houseNumber,
    location: source.location,
    zip: source.zip,
    country: source.country,
    organizationName: source.organizationName,
    organizationStreet: source.organizationStreet,
    organizationHouseNumber: source.organizationHouseNumber,
    organizationLocation: source.organizationLocation,
    organizationZip: source.organizationZip,
    organizationCountry: source.organizationCountry,
    phone: source.phone,
    language: source.language,
  };
}
