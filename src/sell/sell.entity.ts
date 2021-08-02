import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  PrimaryColumn,
  Index,
  CreateDateColumn,
  ManyToOne,
} from 'typeorm';
import * as typeorm from 'typeorm';
import { User } from 'src/user/user.entity';

@Entity()
@Index('ibanAsset', (sell: Sell) => [sell.iban, sell.fiat], { unique: true })
export class Sell {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 34 })
  address: string;

  @Column({ type: 'varchar', length: 32 })
  iban: string;

  @Column({ type: 'int' })
  fiat: number;

  @Column({ type: 'int', unique: true })
  deposit: number;

  @Column({ default: 1 })
  active: boolean;

  @CreateDateColumn() 
  created: Date;

  @ManyToOne(() => User, (user) => user.sells, { nullable: false}) 
  user: User;
}
