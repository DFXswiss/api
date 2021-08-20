import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { User } from 'src/user/user.entity';
import { UserData } from 'src/userData/userData.entity';

@Entity()
export class Country {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true, length: 4 })
  symbol: string;

  @Column({ type: 'varchar', length: 34 })
  name: string;

  @Column({ default: 1 })
  enable: boolean;

  @CreateDateColumn() 
  created: Date;

  @OneToMany(() => User, (user) => user.country)
  users: User[]

  @OneToMany(() => UserData, (userData) => userData.country)
  userData: UserData[]
}
