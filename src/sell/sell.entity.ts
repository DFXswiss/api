import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToOne,
  OneToMany,
} from 'typeorm';
import { User } from 'src/user/user.entity';
import { Fiat } from 'src/fiat/fiat.entity';
import { Deposit } from 'src/deposit/deposit.entity';
import { SellPayment } from 'src/payment/payment-sell.entity';

@Entity()
@Index('ibanAsset', (sell: Sell) => [sell.iban, sell.fiat], { unique: true })
export class Sell {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 34 })
  address: string;

  @Column({ type: 'varchar', length: 32 })
  iban: string;

  @ManyToOne(() => Fiat, { eager: true })
  @JoinColumn()
  fiat: Fiat;

  @OneToOne(() => Deposit, { eager: true })
  @JoinColumn()
  deposit: Deposit;

  @Column({ default: 1 })
  active: boolean;

  @CreateDateColumn()
  created: Date;

  @ManyToOne(() => User, (user) => user.sells)
  user: User;

  @OneToMany(() => SellPayment, (sellPayment) => sellPayment.sell)
  sellPayment: SellPayment[];
}
