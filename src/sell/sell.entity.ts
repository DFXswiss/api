import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn } from 'typeorm';
import * as typeorm from 'typeorm';

@Entity()
export class Sell {
  @PrimaryColumn({ type: 'varchar', unique: true, length: 42 })
  id: string;

  @Column({ type: 'varchar', length: 34 })
  address: string;

  @Column({ type: 'varchar', length: 32 })
  iban: string;

  @Column({ type: 'int' })
  fiat: number;

  @Column({ type: 'int', unique: true })
  deposit_id: string; //TODO: Objekt Referenzieren

  @Column({ type: 'tinyint', default: 1 })
  active: boolean;
}
