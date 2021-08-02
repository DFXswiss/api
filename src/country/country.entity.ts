import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';
import * as typeorm from 'typeorm';

@Entity()
export class Country {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true, length: 4 })
  symbol: string;

  @Column({ type: 'varchar', length: 34 })
  name: string;

  @Column({ default: 1 })
  enable: boolean;

  @CreateDateColumn() 
  created: Date;
}
