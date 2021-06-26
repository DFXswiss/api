import { TypeOrmConfig } from 'src/config/typeorm.config';
import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn } from 'typeorm';
import * as typeorm from 'typeorm';

@Entity()
export class Fiat {
  @PrimaryColumn({ type: 'int', unique: true, length: 3 })
  id: number;

  @Column({ type: 'varchar', length: 34 })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  type: string;

  @Column({ type: 'tinyint', length: 1, default: 1 })
  enable: boolean;
}
