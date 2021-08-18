import { Entity, Column, JoinColumn, ManyToOne } from 'typeorm';
import { Payment } from './payment.entity';
import { Buy } from 'src/buy/buy.entity';

@Entity()
export class BuyPayment extends Payment {
  @Column({ type: 'float', nullable: true })
  fiatValue: number;

  @Column({ type: 'varchar', length: 32, nullable: true })
  iban: string;

  @ManyToOne(() => Buy, { eager: false })
  @JoinColumn()
  buy: Buy;
}
