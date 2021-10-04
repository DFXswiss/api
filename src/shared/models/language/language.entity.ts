import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany, UpdateDateColumn } from 'typeorm';
import { User } from 'src/user/models/user/user.entity';

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

  @OneToMany(() => User, (user) => user.language)
  users: User[];

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
