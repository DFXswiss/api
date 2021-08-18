import { Entity, Column, JoinColumn, ManyToOne } from 'typeorm';
import { Payment } from './payment.entity';
import { Sell } from 'src/sell/sell.entity';

@Entity()
export class SellPayment extends Payment {
  @Column({ type: 'varchar', length: 34, nullable: true })
  depositAddress: string;

  @Column({ type: 'float', nullable: true })
  assetValue: number;

  @ManyToOne(() => Sell, { eager: false })
  @JoinColumn()
  sell: Sell;
}
