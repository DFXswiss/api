import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToOne, UpdateDateColumn } from 'typeorm';
import { Sell } from '../sell/sell.entity';
import { Staking } from '../staking/staking.entity';

@Entity()
export class Deposit {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 256 })
  address: string;

  @OneToOne(() => Sell, (sell) => sell.deposit, { nullable: true })
  sell: Sell;

  @OneToOne(() => Staking, (staking) => staking.deposit, { nullable: true })
  staking: Staking;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
