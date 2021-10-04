import { Entity, PrimaryGeneratedColumn, OneToOne, UpdateDateColumn, CreateDateColumn } from 'typeorm';
import { UserData } from './userData.entity';

@Entity()
export class KycFile {
  @PrimaryGeneratedColumn()
  id: number; // kycFileReference

  // @OneToOne(() => UserData, (userData) => userData.kycFile)
  // userData: UserData;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
