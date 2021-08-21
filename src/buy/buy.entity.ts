import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Asset } from 'src/asset/asset.entity';
import { User } from 'src/user/user.entity';
import { BuyPayment } from 'src/payment/payment-buy.entity';

@Entity()
@Index('ibanAsset', (buy: Buy) => [buy.iban, buy.asset], { unique: true })
export class Buy {
  @PrimaryGeneratedColumn()
  id: number;

  //TODO addresse löschen 
  @Column({ type: 'varchar', length: 34 })
  address: string;

  @Column({ type: 'varchar', length: 32 })
  iban: string;

  @Column({ type: 'varchar', length: 14, unique: true })
  bankUsage: string;

  @Column({ default: 1 })
  active: boolean;

  @CreateDateColumn()
  created: Date;

  @ManyToOne(() => User, (user) => user.buys, { lazy: true })
  user: User;

  @ManyToOne(() => Asset, { eager: true })
  @JoinColumn()
  asset: Asset;

  @OneToMany(() => BuyPayment, (buyPayment) => buyPayment.buy)
  buyPayment: BuyPayment[];
}
