import { IEntity } from 'src/shared/models/entity';
import { Column, Entity } from 'typeorm';

export interface BankAccountInfos {
  result?: string;
  returnCode?: number;
  checks?: string;
  bic?: string;
  allBicCandidates?: string;
  bankCode?: string;
  bankAndBranchCode?: string;
  bankName?: string;
  bankAddress?: string;
  bankUrl?: string;
  branch?: string;
  branchCode?: string;
  sct?: boolean;
  sdd?: boolean;
  b2b?: boolean;
  scc?: boolean;
  sctInst?: boolean;
  sctInstReadinessDate?: Date;
  accountNumber?: string;
  dataAge?: string;
  ibanListed?: string;
  ibanWwwOccurrences?: number;
}

@Entity()
export class BankAccount extends IEntity implements BankAccountInfos {
  @Column({ length: 256, nullable: true })
  iban: string;

  @Column({ length: 256, nullable: true })
  result?: string;

  @Column({ nullable: true })
  returnCode?: number;

  @Column({ length: 256, nullable: true })
  checks?: string;

  @Column({ length: 'MAX', nullable: true })
  bic?: string;

  @Column({ length: 'MAX', nullable: true })
  allBicCandidates?: string;

  @Column({ length: 256, nullable: true })
  bankCode?: string;

  @Column({ length: 256, nullable: true })
  bankAndBranchCode?: string;

  @Column({ length: 256, nullable: true })
  bankName?: string;

  @Column({ length: 256, nullable: true })
  bankAddress?: string;

  @Column({ length: 256, nullable: true })
  bankUrl?: string;

  @Column({ length: 256, nullable: true })
  branch?: string;

  @Column({ length: 256, nullable: true })
  branchCode?: string;

  @Column({ nullable: true })
  sct?: boolean;

  @Column({ nullable: true })
  sdd?: boolean;

  @Column({ nullable: true })
  b2b?: boolean;

  @Column({ nullable: true })
  scc?: boolean;

  @Column({ nullable: true })
  sctInst?: boolean;

  @Column({ type: 'datetime2', nullable: true })
  sctInstReadinessDate?: Date;

  @Column({ length: 256, nullable: true })
  accountNumber?: string;

  @Column({ length: 256, nullable: true })
  dataAge?: string;

  @Column({ length: 256, nullable: true })
  ibanListed?: string;

  @Column({ nullable: true })
  ibanWwwOccurrences?: number;
}
