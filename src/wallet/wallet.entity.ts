import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
export class Wallet {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true, length: 256 })
  address: string;

  @Column({ type: 'varchar', unique: true, length: 256 })
  signature: string;

  @Column({ type: 'varchar', length: 256, default: null, nullable: true })
  mail: string;

  @Column({ type: 'varchar', length: 256, default: null, nullable: true })
  description: string;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
