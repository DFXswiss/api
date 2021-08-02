import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  PrimaryColumn,
  Index,
  CreateDateColumn,
} from 'typeorm';
import * as typeorm from 'typeorm';
import { Payment, PaymentError, PaymentStatus, PaymentType } from './payment.entity';

@Entity()
export class BuyPayment extends Payment{

  @Column({ type: 'float', nullable: true })
  fiatValue: number;

}
