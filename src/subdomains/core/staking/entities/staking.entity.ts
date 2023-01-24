import { Deposit } from 'src/subdomains/supporting/address-pool/deposit/deposit.entity';
import { DepositRoute } from 'src/subdomains/supporting/address-pool/route/deposit-route.entity';
import { StakingReward } from 'src/subdomains/core/staking/entities/staking-reward.entity';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { ManyToOne, ChildEntity, Column, OneToMany } from 'typeorm';

@ChildEntity()
export class Staking extends DepositRoute {
  @ManyToOne(() => Deposit, { eager: true, nullable: true })
  rewardDeposit: Deposit;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  rewardAsset: Asset;

  @ManyToOne(() => Deposit, { eager: true, nullable: true })
  paybackDeposit: Deposit;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  paybackAsset: Asset;

  @ManyToOne(() => User, (user) => user.stakingRoutes, { nullable: false })
  user: User;

  @Column({ type: 'float', default: 0 })
  rewardVolume: number;

  @OneToMany(() => StakingReward, (reward) => reward.staking)
  rewards: StakingReward[];
}
