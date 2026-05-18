import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { Column, Entity, JoinTable, ManyToMany, ManyToOne } from 'typeorm';
import { MrosStatus } from './mros-status.enum';

export interface MrosPersonOverrides {
  gender?: string;
  middleName?: string;
  birthPlace?: string;
  profession?: string;
  sourceOfWealth?: string;
  canton?: string;
  idDocIssueDate?: string;
  idDocValidUntil?: string;
  idDocIssuingCountryCode?: string;
}

@Entity()
export class Mros extends IEntity {
  @ManyToOne(() => UserData, { nullable: false })
  userData: UserData;

  @Column({ length: 256 })
  status: MrosStatus;

  @Column({ length: 256, default: 'SAR' })
  reportCode: string;

  @Column({ type: 'timestamp', nullable: true })
  submissionDate?: Date;

  @Column({ length: 256, nullable: true })
  authorityReference?: string;

  @Column({ length: 256 })
  caseManager: string;

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @Column({ type: 'text', nullable: true })
  action?: string;

  // JSON-serialized string[] of goAML indicator codes (e.g. ["0002M","1004V"])
  @Column({ type: 'text', nullable: true })
  indicators?: string;

  get indicatorCodes(): string[] {
    return this.indicators ? JSON.parse(this.indicators) : [];
  }

  set indicatorCodes(codes: string[]) {
    this.indicators = JSON.stringify(codes);
  }

  // Fields that override UserData when the compliance officer needs to
  // supply goAML-required data that is not captured on UserData (e.g.
  // gender, middle name, profession).
  @Column({ type: 'simple-json', nullable: true })
  personOverrides?: MrosPersonOverrides;

  @ManyToMany(() => Transaction)
  @JoinTable()
  transactions: Transaction[];
}
