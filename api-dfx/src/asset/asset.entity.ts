import { TypeOrmConfig } from 'src/config/typeorm.config';
import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn } from 'typeorm';
import * as typeorm from 'typeorm';

@Entity()
export class Asset {
  @PrimaryColumn({ type: 'int', unique: true, length: 4 })
  id: number;

  @Column({ type: 'varchar', length: 34 })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  type: string;

  @Column({ type: 'tinyint', length: 1, default: 1 })
  buyable: boolean;

  @Column({ type: 'tinyint', length: 1, default: 1 })
  sellable: boolean;
}
