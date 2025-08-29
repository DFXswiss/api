import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { Transaction } from './transaction.entity';

export enum RiskType {
  COMPLIANCE = 'Compliance',
}

export enum AssessmentStatus {
  CREATED = 'Created',
  PENDING = 'Pending',
  COMPLETED = 'Completed',
}

@Entity()
export class TransactionRiskAssessment extends IEntity {
  @Column()
  type: RiskType;

  @Column({ length: 'MAX', nullable: true })
  reason: string;

  @Column({ length: 'MAX', nullable: true })
  methods: string;

  @Column({ length: 'MAX', nullable: true })
  summary: string;

  @Column({ length: 'MAX', nullable: true })
  result: string;

  @Column({ type: 'datetime2', nullable: true })
  date: Date;

  @Column({ nullable: true })
  author: string;

  @Column({ length: 'MAX', nullable: true })
  pdf: string;

  @Column({ default: AssessmentStatus.CREATED })
  status: AssessmentStatus;

  @ManyToOne(() => Transaction, (t) => t.riskAssessments, { nullable: false })
  @JoinColumn()
  transaction: Transaction;
}
