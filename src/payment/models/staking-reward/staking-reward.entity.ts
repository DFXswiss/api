import { Column, ManyToOne, Index, Entity } from 'typeorm';
import { Reward } from '../reward/reward.entity';
import { Staking } from '../staking/staking.entity';

@Entity()
@Index('oneRewardPerRouteCheck', (reward: StakingReward) => [reward.txId, reward.staking], { unique: true })
export class StakingReward extends Reward {
  @Column({ type: 'float', nullable: true })
  fee: number;

  @Column({ type: 'datetime2', nullable: true })
  inputDate: Date;

  @ManyToOne(() => Staking, (staking) => staking.rewards, { nullable: false })
  staking: Staking;
}
