import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany, UpdateDateColumn } from 'typeorm';
import { Sell } from 'src/user/models/sell/sell.entity';
import { Log } from 'src/user/models/log/log.entity';

@Entity()
export class Fiat {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 256 })
  name: string;

  @Column({ default: true })
  enable: boolean;

  @OneToMany(() => Sell, (sell) => sell.fiat)
  sells: Sell[];

  @OneToMany(() => Log, (log) => log.fiat)
  logs: Log[];

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
