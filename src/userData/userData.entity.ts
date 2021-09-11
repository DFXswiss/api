import { Country } from 'src/country/country.entity';
import { User } from 'src/user/user.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  UpdateDateColumn,
} from 'typeorm';

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
@Index(
  'nameLocation',
  (userData: UserData) => [userData.name, userData.location],
  { unique: true },
)
export class UserData {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 256 })
  name: string;

  @Column({ type: 'varchar', length: 256 })
  location: string;

  @ManyToOne(() => Country, { eager: true })
  @JoinColumn()
  country: Country;

  @Column({ type: 'varchar', length: 256, default: NameCheckStatus.NA })
  nameCheck: NameCheckStatus;

  @Column({ type: 'datetime2', nullable: true })
  nameCheckOverrideDate: Date;

  @Column({ type: 'varchar', length: 256, nullable: true})
  nameCheckOverrideComment: string;

  @Column({ type: 'varchar', length: 256, default: KycStatus.NA })
  kycStatus: KycStatus;

  @Column({ nullable: true })
  kycFileReference: number;

  @Column({ type: 'datetime2', nullable: true })
  kycRequestDate: Date;

  @Column({ default: false })
  kycFailure: boolean;

  @OneToMany(() => User, (user) => user.userData, { eager: true })
  users: User[];

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
