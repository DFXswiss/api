import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany, UpdateDateColumn } from 'typeorm';
import { User } from 'src/user/user.entity';
import { UserData } from 'src/userData/userData.entity';

@Entity()
export class Country {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true, length: 10 })
  symbol: string;

  @Column({ type: 'varchar', length: 256 })
  name: string;

  @Column({ default: 1 })
  enable: boolean;

  @OneToMany(() => User, (user) => user.country)
  users: User[]

  @OneToMany(() => UserData, (userData) => userData.country)
  userData: UserData[]

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn() 
  created: Date;
}
