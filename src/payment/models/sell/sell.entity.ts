import { Column, ManyToOne, ChildEntity } from 'typeorm';
import { User } from 'src/user/models/user/user.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { DepositRoute } from '../route/deposit-route.entity';

@ChildEntity()
export class Sell extends DepositRoute {
  @Column({ length: 256 })
  iban: string;

  @ManyToOne(() => Fiat, { eager: true, nullable: true })
  fiat: Fiat;

  @Column({ type: 'float', default: 0 })
  volume: number;

  @Column({ type: 'float', default: 0 })
  annualVolume: number;

  @ManyToOne(() => User, (user) => user.sells, { nullable: false })
  user: User;
}
