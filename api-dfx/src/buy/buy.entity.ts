import { TypeOrmConfig } from 'src/config/typeorm.config';
import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn } from 'typeorm';
import * as typeorm from 'typeorm';

@Entity()
export class Buy {
  @PrimaryColumn({ type: 'varchar', unique: true, length: 42 })
  id: string;

  @Column({ type: 'varchar', length: 34 })
  address: string;

  @Column({ type: 'varchar', length: 32 })
  iban: string;

  @Column({ type: 'int', length: 9 })
  asset: number;

  @Column({ type: 'varchar', length: 15 })
  bank_usage: string; //TODO: Objekt Referenzieren

  @Column({ type: 'tinyint', length: 1, default: 1 })
  active: boolean;
}
