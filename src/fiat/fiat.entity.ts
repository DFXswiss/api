import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn, CreateDateColumn, OneToMany } from 'typeorm';
import * as typeorm from 'typeorm';
import { Sell } from 'src/sell/sell.entity';

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

  @OneToMany(() => Sell, (sell) => sell.fiat)
  sells: Sell[]
}
