import { JoinColumn, OneToOne, ManyToOne, ChildEntity } from 'typeorm';
import { DepositRoute } from '../deposit/deposit-route.entity';
import { Deposit } from '../deposit/deposit.entity';
import { User } from '../user/user.entity';

@ChildEntity()
export class Staking extends DepositRoute {
  @OneToOne(() => Deposit, { eager: true, nullable: true })
  @JoinColumn()
  rewardDeposit: Deposit;

  @OneToOne(() => Deposit, { eager: true, nullable: true })
  @JoinColumn()
  paybackDeposit: Deposit;

  @ManyToOne(() => User, (user) => user.stakingRoutes, { nullable: false })
  user: User;
}
