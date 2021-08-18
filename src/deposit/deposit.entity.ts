import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToOne,
} from 'typeorm';
import { Sell } from 'src/sell/sell.entity';

@Entity()
export class Deposit {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true, length: 42 })
  address: string;

  @Column({ default: false })
  used: boolean;

  @CreateDateColumn()
  created: Date;

  @OneToOne(() => Sell, (sell) => sell.deposit)
  sells: Sell[];
}
