import { IEntity } from 'src/shared/models/entity';
import { Entity, TableInheritance, OneToOne, JoinColumn, Column } from 'typeorm';
import { Deposit } from '../deposit/deposit.entity';

export enum RouteType {
  SELL = 'Sell',
  STAKING = 'Staking',
  CRYPTO = 'Crypto',
}

@Entity()
@TableInheritance({ column: { type: 'nvarchar', name: 'type' } })
export class DepositRoute extends IEntity {
  @Column()
  type: RouteType;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'float', default: 0 })
  volume: number;

  @OneToOne(() => Deposit, (deposit) => deposit.route, { eager: true, nullable: false })
  @JoinColumn()
  deposit: Deposit;
}
