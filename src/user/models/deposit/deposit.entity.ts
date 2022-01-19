import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToOne, UpdateDateColumn } from 'typeorm';
import { DepositRoute } from './deposit-route.entity';

@Entity()
export class Deposit {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 256 })
  address: string;

  @OneToOne(() => DepositRoute, (route) => route.deposit, { nullable: true })
  route: DepositRoute;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
