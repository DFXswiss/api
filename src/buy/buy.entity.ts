import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn } from 'typeorm';
import * as typeorm from 'typeorm';

@Entity()
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
  bank_usage: string; //TODO: Objekt Referenzieren

  @Column({ type: 'tinyint', default: 1 })
  active: boolean;
}
