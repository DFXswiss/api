import { Entity, Column, ManyToOne } from 'typeorm';
import { Reward } from '../reward/reward.entity';
import { Staking } from '../staking/staking.entity';

@Entity()
export class StakingReward extends Reward {
  @Column({ type: 'float', nullable: true })
  fee: number;

  @Column({ type: 'float', nullable: true })
  apr: number;

  @Column({ type: 'float', nullable: true })
  apy: number;

  @Column({ type: 'datetime2', nullable: true })
  inputDate: Date;

  @ManyToOne(() => Staking, { nullable: false }) // soll es auch anders herum von staking aus funktionieren?
  route: Staking;
}
