import { User } from 'src/user/user.entity';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';

@Entity()
export class Wallet {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true, length: 256 })
  address: string;

  @Column({ type: 'varchar', unique: true, length: 256 })
  signature: string;

  @Column({ type: 'varchar', length: 256, nullable: true })
  mail: string;

  @Column({ type: 'varchar', length: 256, nullable: true })
  description: string;

  @OneToMany(() => User, (user) => user.wallet)
  logs: User[];

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
