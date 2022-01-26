import {
  Entity,
  TableInheritance,
  OneToOne,
  JoinColumn,
  Column,
  CreateDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Deposit } from './deposit.entity';

export enum RouteType {
  SELL = 'Sell',
  STAKING = 'Staking',
}

@Entity()
@TableInheritance({ column: { type: 'nvarchar', name: 'type' } })
export class DepositRoute {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  type: RouteType;

  @Column({ default: true })
  active: boolean;

  @OneToOne(() => Deposit, (deposit) => deposit.route, { eager: true, nullable: false })
  @JoinColumn()
  deposit: Deposit;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
