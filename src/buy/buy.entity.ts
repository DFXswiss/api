import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Asset } from 'src/asset/asset.entity';
import { User } from 'src/user/user.entity';
import { BuyPayment } from 'src/payment/payment-buy.entity';

@Entity()
@Index('ibanAddressAsset', (buy: Buy) => [buy.iban, buy.asset, buy.address], { unique: true })
export class Buy {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 256 })
  address: string;

  @Column({ type: 'varchar', length: 256 })
  iban: string;

  @Column({ type: 'varchar', length: 256, unique: true })
  bankUsage: string;

  @Column({ default: true })
  active: boolean;

  @ManyToOne(() => User, (user) => user.buys, { lazy: true })
  user: User;

  @ManyToOne(() => Asset, { eager: true })
  @JoinColumn()
  asset: Asset;

  @OneToMany(() => BuyPayment, (buyPayment) => buyPayment.buy)
  buyPayment: BuyPayment[];

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
