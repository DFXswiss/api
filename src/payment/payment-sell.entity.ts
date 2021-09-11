import { Entity, Column, JoinColumn, ManyToOne } from 'typeorm';
import { Payment } from './payment.entity';
import { Sell } from 'src/sell/sell.entity';

@Entity()
export class SellPayment extends Payment {
  @Column({ length: 256, nullable: true })
  depositAddress: string;

  @Column({ type: 'float', nullable: true })
  assetValue: number;

  @ManyToOne(() => Sell)
  @JoinColumn()
  sell: Sell;
}
