import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToOne, UpdateDateColumn } from 'typeorm';
import { Sell } from 'src/user/models/sell/sell.entity';

@Entity()
export class Deposit {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 256 })
  address: string;

  @OneToOne(() => Sell, (sell) => sell.deposit)
  sell: Sell;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
