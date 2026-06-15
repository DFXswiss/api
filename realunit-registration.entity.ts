import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { User } from './user.entity';

@Entity()
export class RealUnitRegistration {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userDataId: number;

  @Column()
  walletAddress: string;

  @Column()
  status: string;

  @ManyToOne(() => User, (user) => user.realUnitRegistrations)
  user: User;
}