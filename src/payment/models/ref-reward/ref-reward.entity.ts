import { User } from 'src/user/models/user/user.entity';
import { Entity, ManyToOne } from 'typeorm';
import { Reward } from '../reward/reward.entity';

@Entity()
export class RefReward extends Reward {
  @ManyToOne(() => User, { nullable: false }) // soll es auch anders herum von staking aus funktionieren?
  user: User;
}
