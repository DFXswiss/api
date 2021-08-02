import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  PrimaryColumn,
  Index,
  OneToOne,
  CreateDateColumn,
  OneToMany,
  ManyToOne,
  ManyToMany,
} from 'typeorm';
import * as typeorm from 'typeorm';
import { Asset } from 'src/asset/asset.entity';
import { User } from 'src/user/user.entity';

@Entity()
@Index('ibanAsset', (buy: Buy) => [buy.iban, buy.asset], { unique: true })
export class Buy {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 34 })
  address: string;

  @Column({ type: 'varchar', length: 32 })
  iban: string;

  @Column()
  asset: number;

  @Column({ type: 'varchar', length: 14, unique: true })
  bankUsage: string;

  @Column({ default: 1 })
  active: boolean;

  @CreateDateColumn()
  created: Date;

  @ManyToOne(() => User, (user) => user.buys, { nullable: false })
  user: User;
}
