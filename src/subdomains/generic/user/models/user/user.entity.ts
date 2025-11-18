import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Buy } from 'src/subdomains/core/buy-crypto/routes/buy/buy.entity';
import { Swap } from 'src/subdomains/core/buy-crypto/routes/swap/swap.entity';
import { CustodyBalance } from 'src/subdomains/core/custody/entities/custody-balance.entity';
import { CustodyOrder } from 'src/subdomains/core/custody/entities/custody-order.entity';
import { CustodyAddressType } from 'src/subdomains/core/custody/enums/custody';
import { RefReward } from 'src/subdomains/core/referral/reward/ref-reward.entity';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { StakingRefReward } from 'src/subdomains/core/staking/entities/staking-ref-reward.entity';
import { Staking } from 'src/subdomains/core/staking/entities/staking.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { Column, Entity, Index, ManyToOne, OneToMany } from 'typeorm';
import { CustodyProvider } from '../custody-provider/custody-provider.entity';
import { UserAddressType, UserStatus, WalletType } from './user.enum';

@Entity()
export class User extends IEntity {
  @Column({ length: 256, unique: true })
  address: string;

  @Column({ length: 256, nullable: true })
  addressType?: UserAddressType;

  @Column({ length: 'MAX', nullable: true })
  signature?: string;

  @Column({ length: 256, nullable: true })
  walletType?: WalletType;

  @Column({ length: 256, nullable: true })
  label?: string;

  @ManyToOne(() => Wallet)
  wallet: Wallet;

  @ManyToOne(() => CustodyProvider)
  custodyProvider: CustodyProvider;

  @Column({ length: 256, default: '000-000' })
  usedRef: string;

  @Column({ length: 256, default: UserRole.USER })
  role: UserRole;

  @Column({ length: 256, default: UserStatus.NA })
  status: UserStatus;

  @Column({ length: 256, default: '0.0.0.0' })
  ip: string;

  @Column({ length: 256, nullable: true })
  ipCountry?: string;

  @Column({ length: 256, nullable: true })
  origin?: string;

  @Column({ length: 256, nullable: true })
  @Index({ unique: true, where: 'apiKeyCT IS NOT NULL' })
  apiKeyCT?: string;

  @Column({ length: 256, nullable: true })
  apiFilterCT?: string;

  @Column({ type: 'float', default: 0 })
  annualBuyVolume: number; // CHF

  @Column({ type: 'float', default: 0 })
  buyVolume: number; // CHF

  @Column({ type: 'float', default: 0 })
  annualSellVolume: number; // CHF

  @Column({ type: 'float', default: 0 })
  sellVolume: number; // CHF

  @Column({ type: 'float', default: 0 })
  annualCryptoVolume: number; // CHF

  @Column({ type: 'float', default: 0 })
  cryptoVolume: number; // CHF

  @Column({ nullable: true })
  approved?: boolean;

  @Column({ type: 'datetime2', nullable: true })
  deactivationDate?: Date;

  @OneToMany(() => Buy, (buy) => buy.user)
  buys: Buy[];

  @OneToMany(() => Sell, (sell) => sell.user)
  sells: Sell[];

  @OneToMany(() => Swap, (swap) => swap.user)
  swaps: Swap[];

  @OneToMany(() => Staking, (staking) => staking.user)
  stakingRoutes: Staking[];

  @ManyToOne(() => UserData, { nullable: false })
  userData: UserData;

  @ManyToOne(() => User, { nullable: true })
  primaryUser: User;

  // --- REF --- //
  @Column({ length: 256, nullable: true })
  @Index({ unique: true, where: 'ref IS NOT NULL' })
  ref?: string;

  @Column({ type: 'float', default: 0.25 })
  refFeePercent: number;

  @Column({ type: 'float', default: 0 })
  refVolume: number; // EUR

  @Column({ type: 'float', default: 0 })
  refCredit: number; // EUR

  @Column({ type: 'float', default: 0 })
  paidRefCredit: number; // EUR

  @OneToMany(() => RefReward, (reward) => reward.user)
  refRewards: RefReward[];

  @OneToMany(() => StakingRefReward, (reward) => reward.user)
  stakingRefRewards: StakingRefReward[];

  @OneToMany(() => Transaction, (transaction) => transaction.user)
  transactions: Transaction[];

  @Column({ length: 'MAX', nullable: true })
  comment?: string;

  @Column({ type: 'int', nullable: true })
  @Index({ unique: true, where: 'custodyAddressIndex IS NOT NULL' })
  custodyAddressIndex?: number;

  @Column({ nullable: true })
  custodyAddressType: CustodyAddressType;

  @OneToMany(() => CustodyOrder, (custodyOrder) => custodyOrder.user)
  custodyOrders: CustodyOrder[];

  @OneToMany(() => CustodyBalance, (custodyBalance) => custodyBalance.user)
  custodyBalances: CustodyBalance[];

  @Column({ type: 'datetime2', nullable: true })
  travelRulePdfDate: Date;

  //*** FACTORY METHODS ***//
  deleteUser(reason: string): UpdateResult<User> {
    const update: Partial<User> = {
      status: UserStatus.DELETED,
      comment: `${reason} (${new Date().toISOString()}); ${this.comment ?? ''}`,
      deactivationDate: new Date(),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  activateUser(): UpdateResult<User> {
    const update: Partial<User> = { status: UserStatus.ACTIVE };

    Object.assign(this, update);

    return [this.id, update];
  }

  setRef(ref: string): UpdateResult<User> {
    const update: Partial<User> = { ref };

    Object.assign(this, update);

    return [this.id, update];
  }

  setLabel(label: string): UpdateResult<User> {
    const update: Partial<User> = { label };

    Object.assign(this, update);

    return [this.id, update];
  }

  get blockchains(): Blockchain[] {
    // wallet name / blockchain map
    const customChains = {
      Talium: ['Talium' as Blockchain],
    };

    return customChains[this.wallet.name] ?? CryptoService.getBlockchainsBasedOn(this.address);
  }

  get isBlockedOrDeleted(): boolean {
    return this.isBlocked || this.isDeleted;
  }

  get isBlocked(): boolean {
    return this.status === UserStatus.BLOCKED;
  }

  get isDeleted(): boolean {
    return this.status === UserStatus.DELETED;
  }
}

export const UserSupportUpdateCols = ['status', 'setRef'];
