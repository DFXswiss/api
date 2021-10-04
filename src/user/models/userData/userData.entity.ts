import { BankData } from 'src/user/models/bankData/bankData.entity';
import { User } from 'src/user/models/user/user.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
} from 'typeorm';
import { KycFile as KycFile } from './kycFile.entity';

export enum NameCheckStatus {
  NA = 'NA',
  SAFE = 'Safe',
  WARNING = 'Warning',
  HIGHRISK = 'HighRisk',
}

export enum KycStatus {
  NA = 'NA',
  WAIT_CHAT_BOT = 'Chatbot',
  WAIT_ADDRESS = 'Address',
  WAIT_ONLINE_ID = 'OnlineId',
  WAIT_MANUAL = 'Manual',
  COMPLETED = 'Completed',
}

export enum UiKycStatus {
  KYC_NO = 'no',
  KYC_PENDING = 'pending',
  KYC_PROV = 'prov',
  KYC_COMPLETED = 'completed',
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

  @Column({ type: 'int', nullable: true })
  kycCustomerId: number;

  @Column({ type: 'int', nullable: true })
  kycFileReference: number;

  @Column({ default: false })
  kycFailure: boolean;

  @OneToOne(() => KycFile, (kycData) => kycData.userData, { nullable: true })
  kycFile: KycFile;

  @OneToMany(() => BankData, (bankData) => bankData.userData)
  bankDatas: BankData[];

  @OneToMany(() => User, (user) => user.userData, { eager: true })
  users: User[];

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
