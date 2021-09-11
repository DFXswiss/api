import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity()
export class Country {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true, length: 10 })
  symbol: string;

  @Column({ type: 'varchar', length: 256 })
  name: string;

  @Column({ default: true })
  enable: boolean;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn() 
  created: Date;
}
