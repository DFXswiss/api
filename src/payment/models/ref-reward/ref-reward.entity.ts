import { User } from 'src/user/models/user/user.entity';
import { ChildEntity, Index, ManyToOne } from 'typeorm';
import { Reward } from '../reward/reward.entity';

@ChildEntity()
@Index('oneRewardPerUserCheck', (refReward: RefReward) => [refReward.txId, refReward.user], {
  unique: true,
})
export class RefReward extends Reward {
  @ManyToOne(() => User, { nullable: true }) // soll es auch anders herum von staking aus funktionieren?
  user: User;
}
