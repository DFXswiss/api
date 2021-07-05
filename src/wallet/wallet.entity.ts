import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn } from 'typeorm';
import * as typeorm from 'typeorm';

@Entity({
  name: 'wallets'
})
export class Wallet {
  @PrimaryColumn({ type: 'varchar', unique: true, length: 34 })
  address: string;

  @Column({ type: 'varchar', length: 88 })
  signature: string;

  @Column({ type: 'varchar', length: 32 })
  mail: string;

  @Column({ type: 'varchar', length: 40 })
  description: string;
}
