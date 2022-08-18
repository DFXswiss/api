import { Buy } from 'src/payment/models/buy/buy.entity';
import { Country } from 'src/shared/models/country/country.entity';
import { Language } from 'src/shared/models/language/language.entity';
import { Sell } from 'src/payment/models/sell/sell.entity';
import { UserData } from 'src/user/models/user-data/user-data.entity';
import { Wallet } from 'src/user/models/wallet/wallet.entity';
import { Entity, Column, OneToMany, ManyToOne, Index } from 'typeorm';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Staking } from '../../../payment/models/staking/staking.entity';
import { IEntity } from 'src/shared/models/entity';
import { AccountType } from '../user-data/account-type.enum';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { RefReward } from 'src/payment/models/ref-reward/ref-reward.entity';
import { StakingRefReward } from 'src/payment/models/staking-ref-reward/staking-ref-reward.entity';
import { BankAccount } from 'src/payment/models/bank-account/bank-account.entity';
import { CryptoRoute } from 'src/payment/models/crypto-route/crypto-route.entity';

export enum UserStatus {
  NA = 'NA',
  ACTIVE = 'Active',
}

@Entity()
export class User extends IEntity {
  @Column({ length: 256, unique: true })
  address: string;

  @Column({ length: 256 })
  signature: string;

  @ManyToOne(() => Wallet)
  wallet: Wallet;

  @Column({ length: 256, default: '000-000' })
  usedRef: string;

  @Column({ length: 256, default: UserRole.USER })
  role: UserRole;

  @Column({ length: 256, default: UserStatus.NA })
  status: UserStatus;

  @Column({ length: 256, default: '0.0.0.0' })
  ip: string;

  @Column({ length: 256, nullable: true })
  ipCountry: string;

  @Column({ length: 'MAX', nullable: true })
  cfpVotes: string;

  @Column({ type: 'float', nullable: true })
  buyFee: number;

  @Column({ type: 'float', nullable: true })
  sellFee: number;

  @Column({ type: 'float', nullable: true })
  stakingFee: number;

  @Column({ type: 'float', nullable: true })
  cryptoFee: number;

  @Column({ type: 'datetime2', nullable: true })
  stakingStart: Date;

  @Column({ length: 256, nullable: true })
  origin: string;

  @Column({ length: 256, nullable: true })
  @Index({ unique: true, where: 'apiKeyCT IS NOT NULL' })
  apiKeyCT: string;

  @Column({ length: 256, nullable: true })
  apiKeyFilterCT: string;

  @Column({ type: 'float', default: 0 })
  annualBuyVolume: number;

  @Column({ type: 'float', default: 0 })
  buyVolume: number;

  @Column({ type: 'float', default: 0 })
  annualSellVolume: number;

  @Column({ type: 'float', default: 0 })
  sellVolume: number;

  @Column({ type: 'float', default: 0 })
  annualCryptoVolume: number;

  @Column({ type: 'float', default: 0 })
  cryptoVolume: number;

  @Column({ type: 'float', default: 0 })
  stakingBalance: number;

  @OneToMany(() => Buy, (buy) => buy.user)
  buys: Buy[];

  @OneToMany(() => Sell, (sell) => sell.user)
  sells: Sell[];

  @OneToMany(() => CryptoRoute, (crypto) => crypto.user)
  cryptoRoutes: CryptoRoute[];

  @OneToMany(() => Staking, (staking) => staking.user)
  stakingRoutes: Staking[];

  @OneToMany(() => BankAccount, (bankAccount) => bankAccount.user)
  bankAccounts: BankAccount[];

  @ManyToOne(() => UserData, { nullable: false })
  userData: UserData;

  // --- REF --- //
  @Column({ length: 256, unique: true })
  ref: string;

  @Column({ type: 'float', default: 0.5 })
  refFeePercent: number;

  @Column({ type: 'float', default: 0 })
  refVolume: number;

  @Column({ type: 'float', default: 0 })
  refCredit: number;

  @Column({ type: 'float', nullable: false, default: 0 })
  paidRefCredit: number;

  @Column({ type: 'float', nullable: false, default: 0 })
  paidStakingRefCredit: number;

  @OneToMany(() => RefReward, (reward) => reward.user)
  refRewards: RefReward[];

  @OneToMany(() => StakingRefReward, (reward) => reward.user)
  stakingRefRewards: StakingRefReward[];

  // --- TO REMOVE --- //
  @Column({ default: AccountType.PERSONAL, length: 256 })
  accountType: AccountType;

  @Column({ length: 256, nullable: true })
  mail: string;

  @Column({ length: 256, nullable: true })
  phone: string;

  @ManyToOne(() => Language)
  language: Language;

  @ManyToOne(() => Fiat)
  currency: Fiat;

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

  @ManyToOne(() => Country)
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

  @ManyToOne(() => Country)
  organizationCountry: Country;
}
