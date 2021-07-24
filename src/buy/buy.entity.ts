import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  PrimaryColumn,
  Index,
  OneToOne,
} from 'typeorm';
import * as typeorm from 'typeorm';
import { Asset } from 'src/asset/asset.entity';

@Entity()
@Index('ibanAsset', (buy: Buy) => [buy.iban, buy.asset], { unique: true })
export class Buy {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 34 })
  address: string;

  @Column({ type: 'varchar', length: 32 })
  iban: string;

  @Column({ type: 'int' })
  asset: number;

  @Column({ type: 'varchar', length: 15 })
  bank_usage: string;

  @Column({ type: 'tinyint', default: 1 })
  active: boolean;
}
