import { Entity, Column, ManyToOne } from 'typeorm';
import { Payment } from './payment.entity';
import { Buy } from 'src/buy/buy.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';

@Entity()
export class BuyPayment extends Payment {
  @Column({ type: 'float', nullable: true })
  fiatValue: number;

  @Column({ length: 256, nullable: true })
  iban: string;

  @Column({ length: 256, unique: true })
  bankTransactionId: string;

  @Column({ type: 'float', nullable: true })
  originFiatValue: number;

  @ManyToOne(() => Fiat, { eager: true })
  originFiat: Fiat;

  @ManyToOne(() => Buy)
  buy: Buy;
}
