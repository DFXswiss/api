import { User } from 'src/user/models/user/user.entity';
import { Entity, Index, ManyToOne } from 'typeorm';
import { Reward } from '../reward/reward.entity';

@Entity()
@Index('oneRewardPerUserCheck', (refReward: RefReward) => [refReward.txId, refReward.user], {
  unique: true,
})
export class RefReward extends Reward {
  @ManyToOne(() => User, { nullable: false }) // soll es auch anders herum von user aus funktionieren?
  user: User;
}
