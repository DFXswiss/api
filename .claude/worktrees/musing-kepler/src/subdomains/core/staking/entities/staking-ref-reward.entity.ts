import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { Reward } from '../../../../shared/models/reward.entity';
import { Staking } from './staking.entity';

export enum StakingRefType {
  REFERRER = 'Referrer',
  REFERRED = 'Referred',
}

@Entity()
export class StakingRefReward extends Reward {
  @ManyToOne(() => User, { nullable: false })
  user: User;

  @ManyToOne(() => Staking, (staking) => staking.rewards, { nullable: true })
  staking?: Staking;

  @Column({ length: 256 })
  stakingRefType: StakingRefType;
}
