import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
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

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @Column({ type: 'text', nullable: true })
  methods?: string;

  @Column({ type: 'text', nullable: true })
  summary?: string;

  @Column({ type: 'text', nullable: true })
  result?: string;

  @Column({ type: 'timestamp', nullable: true })
  date?: Date;

  @Column({ nullable: true })
  author?: string;

  @Column({ type: 'text', nullable: true })
  pdf?: string;

  @Column({ default: AssessmentStatus.CREATED })
  status: AssessmentStatus;

  @Index()
  @ManyToOne(() => Transaction, (t) => t.riskAssessments, { nullable: false })
  @JoinColumn()
  transaction: Transaction;
}
