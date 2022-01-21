import { ManyToOne, ChildEntity } from 'typeorm';
import { DepositRoute } from '../deposit/deposit-route.entity';
import { Deposit } from '../deposit/deposit.entity';
import { User } from '../user/user.entity';

@ChildEntity()
export class Staking extends DepositRoute {
  @ManyToOne(() => Deposit, { eager: true, nullable: true })
  rewardDeposit: Deposit;

  @ManyToOne(() => Deposit, { eager: true, nullable: true })
  paybackDeposit: Deposit;

  @ManyToOne(() => User, (user) => user.stakingRoutes, { nullable: false })
  user: User;

  // TODO: volume
}
