import { PrimaryGeneratedColumn, UpdateDateColumn, CreateDateColumn } from 'typeorm';

export class IEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
