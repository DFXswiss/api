import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { Reward } from '../../../../shared/models/reward.entity';
import { Staking } from './staking.entity';

export enum PayoutType {
  REINVEST = 'Reinvest',
  WALLET = 'Wallet',
  BANK_ACCOUNT = 'BankAccount',
}

@Entity()
@Index('oneRewardPerRouteCheck', (reward: StakingReward) => [reward.txId, reward.staking], { unique: true })
export class StakingReward extends Reward {
  @Column({ type: 'float', nullable: true })
  fee?: number;

  @Column({ type: 'datetime2', nullable: true })
  inputDate?: Date;

  @Column({ length: 256 })
  payoutType: PayoutType;

  @ManyToOne(() => Staking, (staking) => staking.rewards, { nullable: false })
  staking: Staking;

  @Column({ length: 256, unique: true })
  internalId: string;
}
