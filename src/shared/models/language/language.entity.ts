import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity()
export class Language {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 10 })
  symbol: string;

  @Column({ length: 256 })
  name: string;

  @Column({ length: 256 })
  foreignName: string;

  @Column({ default: true })
  enable: boolean;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
