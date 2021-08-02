import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  PrimaryColumn,
  Index,
  CreateDateColumn,
} from 'typeorm';
import * as typeorm from 'typeorm';
import { Payment } from './payment.entity';

@Entity()
export class SellPayment extends Payment{

  @Column({ type: 'varchar', length: 34, nullable: true })
  depositAddress: string;

  @Column({ type: 'int', nullable: true })
  fiat: number;

  @Column({ type: 'int', nullable: true })
  asset: number;

  @Column({ type: 'float', nullable: true })
  assetValue: number;
}
