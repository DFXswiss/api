import { User } from 'src/user/user.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  PrimaryColumn,
  OneToMany,
  CreateDateColumn,
  ManyToOne,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity()
@Index('nameLocation', (userData: UserData) => [userData.name, userData.location], { unique: true })
export class UserData {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar' })
  location: string;

  @Column({ type: 'varchar' })
  country: string;

  @Column({ type: 'float', default: 0 })
  monthlyValue: number;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;

  @OneToMany(() => User, (user) => user.id)
  users: User[];
}