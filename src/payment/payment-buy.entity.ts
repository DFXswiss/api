import { Entity, Column, JoinColumn, ManyToOne } from 'typeorm';
import { Payment } from './payment.entity';
import { Buy } from 'src/buy/buy.entity';
import { Fiat } from 'src/fiat/fiat.entity';

@Entity()
export class BuyPayment extends Payment {
  @Column({ type: 'float', nullable: true })
  fiatValue: number;

  @Column({ type: 'varchar', length: 256, nullable: true })
  iban: string;

  @Column({ type: 'varchar', length: 256, unique: true })
  bankTransactionId: string;

  @Column({ type: 'float', nullable: true })
  originFiatValue: number;

  @ManyToOne(() => Fiat, { eager: true })
  @JoinColumn()
  originFiat: Fiat;

  @ManyToOne(() => Buy, { lazy: true })
  @JoinColumn()
  buy: Buy;
}
