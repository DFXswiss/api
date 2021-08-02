import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';
import * as typeorm from 'typeorm';

@Entity()
export class Deposit {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true, length: 42 })
  address: string;

  @Column({ default: false })
  used: boolean;

  @CreateDateColumn() 
  created: Date;
}
