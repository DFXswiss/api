import { User } from 'src/user/models/user/user.entity';
import { ChildEntity, ManyToOne } from 'typeorm';
import { Reward } from '../reward/reward.entity';

@ChildEntity()
export class RefReward extends Reward {
  @ManyToOne(() => User, { nullable: true }) // soll es auch anders herum von staking aus funktionieren?
  user: User;
}
