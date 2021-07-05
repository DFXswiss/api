import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn } from 'typeorm';
import * as typeorm from 'typeorm';

@Entity({
  name: 'deposit_address'
})
export class Deposit {
  // @PrimaryGeneratedColumn('uuid')
  // id: string;

  @PrimaryColumn({ type: 'varchar', unique: true, length: 42 })
  address: string;

  @Column({ type: 'tinyint',  default: 1 })
  used: boolean;
}
