import { TypeOrmConfig } from 'src/config/typeorm.config';
import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn } from 'typeorm';
import * as typeorm from 'typeorm';

@Entity()
export class Country {
  @PrimaryColumn({ type: 'varchar', unique: true, length: 4 })
  symbol: string;

  @Column({ type: 'varchar', length: 34 })
  name: string;

  @Column({ type: 'tinyint', length: 1, default: 1 })
  enable: boolean;
}
