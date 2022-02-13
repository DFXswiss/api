import { Column, ManyToOne, ChildEntity, Index } from 'typeorm';
import { Reward } from '../reward/reward.entity';
import { Staking } from '../staking/staking.entity';

@ChildEntity()
@Index(
  'sameRewardPerRoute',
  (stakingReward: StakingReward) => [stakingReward.outputDate, stakingReward.txId, stakingReward.staking],
  { unique: true },
)
export class StakingReward extends Reward {
  @Column({ type: 'float', nullable: true })
  fee: number;

  @Column({ type: 'float', nullable: true })
  apr: number;

  @Column({ type: 'float', nullable: true })
  apy: number;

  @Column({ type: 'datetime2', nullable: true })
  inputDate: Date;

  @ManyToOne(() => Staking, (staking) => staking.stakingReward, { nullable: true })
  staking: Staking;
}
