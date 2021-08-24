import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  UpdateDateColumn,
} from 'typeorm';
import { Sell } from 'src/sell/sell.entity';

@Entity()
export class Fiat {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true, length: 256 })
  name: string;

  @Column({ default: 1 })
  enable: boolean;

  @OneToMany(() => Sell, (sell) => sell.fiat)
  sells: Sell[];

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
