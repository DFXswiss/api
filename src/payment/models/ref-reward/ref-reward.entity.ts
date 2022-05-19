import { User } from 'src/user/models/user/user.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { Reward } from '../reward/reward.entity';

@Entity()
@Index('oneRewardPerUserCheck', (reward: RefReward) => [reward.txId, reward.user], { unique: true })
export class RefReward extends Reward {
  @ManyToOne(() => User, { nullable: false })
  user: User;

  @Column({ length: 256, nullable: false, unique: true })
  internalId: string;
}
