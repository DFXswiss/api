import { User } from 'src/user/models/user/user.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { Reward } from '../reward/reward.entity';
import { Staking } from '../staking/staking.entity';

export enum StakingRefType {
  REFERRER = 'Referrer',
  REFERRED = 'Referred',
}

@Entity()
export class StakingRefReward extends Reward {
  @ManyToOne(() => User, { nullable: false })
  user: User;

  @ManyToOne(() => Staking, (staking) => staking.rewards, { nullable: true })
  staking: Staking;

  @Column({ length: 256, nullable: false })
  stakingRefType: StakingRefType;
}
