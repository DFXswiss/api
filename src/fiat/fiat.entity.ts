import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';
import * as typeorm from 'typeorm';

@Entity()
export class Fiat {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true, length: 34 })
  name: string;

  @Column({ default: 1 })
  enable: boolean;

  @CreateDateColumn() 
  created: Date;
}
