import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity()
export class Ref {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 256 })
  ref: string;

  @Column({ length: 256, unique: true })
  ip: string;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
