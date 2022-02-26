import { Column, ManyToOne, Index, Entity } from 'typeorm';
import { Reward } from '../reward/reward.entity';
import { Staking } from '../staking/staking.entity';

export enum StakingRewardType {
  WALLET = 'Wallet',
  REINVEST = 'Reinvest',
  SELL = 'Sell',
}

@Entity()
@Index('oneRewardPerRouteCheck', (reward: StakingReward) => [reward.txId, reward.staking], { unique: true })
export class StakingReward extends Reward {
  @Column({ type: 'float', nullable: true })
  fee: number;

  @Column({ type: 'datetime2', nullable: true })
  inputDate: Date;

  @Column({ length: 256, nullable: false })
  stakingRewardType: StakingRewardType;

  @ManyToOne(() => Staking, (staking) => staking.rewards, { nullable: false })
  staking: Staking;
}
