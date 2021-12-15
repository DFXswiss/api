import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToOne,
  UpdateDateColumn,
} from 'typeorm';
import { User } from 'src/user/models/user/user.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Deposit } from 'src/user/models/deposit/deposit.entity';

@Entity()
@Index('ibanFiatUser', (sell: Sell) => [sell.iban, sell.fiat, sell.user], { unique: true })
export class Sell {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 256 })
  iban: string;

  @ManyToOne(() => Fiat, { eager: true, nullable: false })
  fiat: Fiat;

  @OneToOne(() => Deposit, (deposit) => deposit.sell, { eager: true, nullable: false })
  @JoinColumn()
  deposit: Deposit;

  @Column({ default: true })
  active: boolean;

  @ManyToOne(() => User, (user) => user.sells, { nullable: false })
  user: User;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
