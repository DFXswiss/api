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
  JoinColumn,
} from 'typeorm';
import { KycFile as KycFile } from './kycFile.entity';

export enum KycStatus {
  NA = 'NA',
  WAIT_CHAT_BOT = 'Chatbot',
  WAIT_ADDRESS = 'Address',
  WAIT_ONLINE_ID = 'OnlineId',
  WAIT_VIDEO_ID = 'VideoId',
  WAIT_MANUAL = 'Manual',
  COMPLETED = 'Completed',
}

export enum KycState {
  NA = 'NA',
  FAILED = 'Failed',
  REMINDED = 'Reminded',
}

@Entity()
export class UserData {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 256, default: KycStatus.NA })
  kycStatus: KycStatus;

  @Column({ length: 256, default: KycState.NA })
  kycState: KycState;

  @Column({ type: 'float', default: 45000 })
  depositLimit: number;

  @OneToOne(() => KycFile, (kycData) => kycData.userData, { nullable: true, eager: true })
  @JoinColumn()
  kycFile: KycFile;

  @OneToMany(() => BankData, (bankData) => bankData.userData)
  bankDatas: BankData[];

  @OneToMany(() => User, (user) => user.userData)
  users: User[];

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
