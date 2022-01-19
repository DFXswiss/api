import {
  JoinColumn,
  OneToOne,
  ManyToOne,
  Index,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Entity,
} from 'typeorm';
import { Deposit } from '../deposit/deposit.entity';
import { User } from '../user/user.entity';

@Entity()
@Index('rewardPaybackUser', (staking: Staking) => [staking.rewardDeposit, staking.paybackDeposit, staking.user], {
  unique: true,
})
export class Staking {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ default: true })
  active: boolean;

  @OneToOne(() => Deposit, (deposit) => deposit.staking, { eager: true, nullable: false })
  @JoinColumn()
  deposit: Deposit;

  @OneToOne(() => Deposit, { eager: true, nullable: true })
  @JoinColumn()
  rewardDeposit: Deposit;

  @OneToOne(() => Deposit, { eager: true, nullable: true })
  @JoinColumn()
  paybackDeposit: Deposit;

  @ManyToOne(() => User, (user) => user.stakingRoutes, { nullable: false })
  user: User;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
