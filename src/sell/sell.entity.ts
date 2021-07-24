import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn, Index } from 'typeorm';
import * as typeorm from 'typeorm';

@Entity()
@Index("ibanAsset", (sell: Sell) => [sell.iban, sell.fiat], { unique: true })
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
  depositId: number;

  @Column({ type: 'tinyint', default: 1 })
  active: boolean;
}
