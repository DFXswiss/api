import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn } from 'typeorm';
import * as typeorm from 'typeorm';

@Entity({
  name: 'token_info'
})
export class Asset {
  @PrimaryColumn({ type: 'int', unique: true })
  id: number;

  @Column({ type: 'varchar', length: 34 })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  type: string;

  @Column({ type: 'tinyint',  default: 1 })
  buyable: boolean;

  @Column({ type: 'tinyint',  default: 1 })
  sellable: boolean;
}
