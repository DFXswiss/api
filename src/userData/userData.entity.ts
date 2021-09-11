import { BankData } from 'src/bankData/bankData.entity';
import { User } from 'src/user/user.entity';
import { Entity, PrimaryGeneratedColumn, Column, OneToMany, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum NameCheckStatus {
  NA = 'NA',
  SAFE = 'Safe',
  WARNING = 'Warning',
  HIGHRISK = 'HighRisk',
}

export enum KycStatus {
  NA = 'NA',
  PROCESSING = 'Processing',
  COMPLETED = 'Completed',
}

@Entity()
export class UserData {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 256, default: NameCheckStatus.NA })
  nameCheck: NameCheckStatus;

  @Column({ type: 'datetime2', nullable: true })
  nameCheckOverrideDate: Date;

  @Column({ length: 256, nullable: true })
  nameCheckOverrideComment: string;

  @Column({ length: 256, default: KycStatus.NA })
  kycStatus: KycStatus;

  @Column({ nullable: true })
  kycFileReference: number;

  @Column({ type: 'datetime2', nullable: true })
  kycRequestDate: Date;

  @Column({ default: false })
  kycFailure: boolean;

  @OneToMany(() => BankData, (bankData) => bankData.userData)
  bankDatas: BankData[];

  @OneToMany(() => User, (user) => user.userData, { eager: true })
  users: User[];

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
