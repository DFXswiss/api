import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn } from 'typeorm';
import * as typeorm from 'typeorm';

@Entity()
export class Log {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true })
  orderId: string;

  @Column({ type: 'varchar' })
  address: string;

  @Column({ type: 'varchar' })
  type: string;

  @Column({ type: 'varchar', nullable: true })
  status: string;

  @Column({ type: 'int', nullable: true })
  fiat: number;

  @Column({ type: 'float', nullable: true })
  fiatValue: number;

  @Column({ type: 'int', nullable: true })
  krypto: number;

  @Column({ type: 'float', nullable: true })
  kryptoValue: number;

  @Column({ type: 'varchar', length: 32, nullable: true })
  iban: string;

  @Column({ type: 'varchar', nullable: true })
  direction: string;

  @Column({ type: 'varchar' })
  message: string;
  
}