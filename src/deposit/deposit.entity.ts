import { TypeOrmConfig } from 'src/config/typeorm.config';
import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn } from 'typeorm';
import * as typeorm from 'typeorm';

@Entity()
export class Deposit {
  @PrimaryColumn({ type: 'varchar', unique: true, length: 42 })
  address: string;

  @Column({ type: 'tinyint', length: 1, default: 1 })
  used: boolean;
}
