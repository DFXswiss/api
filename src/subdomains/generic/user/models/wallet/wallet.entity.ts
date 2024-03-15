import { IEntity } from 'src/shared/models/entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, Index, OneToMany } from 'typeorm';
import { KycStatus, KycType } from '../user-data/user-data.entity';

export enum AmlRule {
  LEVEL_0 = 0, // default
  LEVEL_1 = 1, // IP Check
  LEVEL_2 = 2, // KycLevel 30
  LEVEL_3 = 3, // KycLevel 50
}

@Entity()
export class Wallet extends IEntity {
  @Column({ length: 256, nullable: true })
  @Index({ unique: true, where: 'address IS NOT NULL' })
  address: string;

  @Column({ length: 256, nullable: true })
  name: string;

  @Column({ length: 256, nullable: true })
  masterKey: string;

  @Column({ default: false })
  isKycClient: boolean;

  @Column({ nullable: true })
  customKyc: KycType;

  @OneToMany(() => User, (user) => user.wallet)
  users: User[];

  @Column({ length: 256, nullable: true })
  identMethod?: KycStatus;

  @Column({ length: 256, nullable: true })
  apiUrl: string;

  @Column({ length: 256, nullable: true })
  apiKey: string;

  @Column({ default: AmlRule.LEVEL_0 })
  amlRule: AmlRule;
}
