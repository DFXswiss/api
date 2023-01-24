import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { Entity, Column, OneToMany, ManyToOne, Index } from 'typeorm';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { IEntity } from 'src/shared/models/entity';
import { RefReward } from 'src/subdomains/core/referral/reward/ref-reward.entity';
import { StakingRefReward } from 'src/subdomains/core/staking/entities/staking-ref-reward.entity';
import { CryptoRoute } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.entity';
import { Buy } from 'src/subdomains/core/buy-crypto/routes/buy/buy.entity';
import { Staking } from 'src/subdomains/core/staking/entities/staking.entity';

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
  apiFilterCT: string;

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

  @ManyToOne(() => UserData, { nullable: false })
  userData: UserData;

  // --- REF --- //
  @Column({ length: 256, unique: true })
  ref: string;

  @Column({ type: 'float', default: 0.25 })
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
}
