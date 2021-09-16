import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToOne, UpdateDateColumn } from 'typeorm';
import { Sell } from 'src/sell/sell.entity';

@Entity()
export class Deposit {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 256 })
  address: string;

  @Column({ default: false })
  used: boolean;

  @OneToOne(() => Sell, (sell) => sell.deposit)
  sells: Sell[];

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
