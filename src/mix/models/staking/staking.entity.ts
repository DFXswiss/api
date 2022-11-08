import { ManyToOne, ChildEntity, Column, OneToMany } from 'typeorm';
import { Deposit } from '../deposit/deposit.entity';
import { User } from '../../../subdomains/generic/user/models/user/user.entity';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { StakingReward } from '../staking-reward/staking-reward.entity';
import { DepositRoute } from '../route/deposit-route.entity';

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
