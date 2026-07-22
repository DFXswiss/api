import { IEntity } from 'src/shared/models/entity';
import { Column, Entity } from 'typeorm';

export enum LogSeverity {
  INFO = 'Info',
  WARNING = 'Warning',
  ERROR = 'Error',
}

export const FINANCIAL_DATA_LOG_SUBSYSTEM = 'FinancialDataLog';
export const FINANCIAL_LOG_VALIDITY_AUDIT_SUBSYSTEM = 'FinancialLogValidityAudit';

// Limits audit-record size and requires callers to use a narrower time or amount range.
export const MAX_VALIDITY_SWEEP_ROWS = 10_000;

@Entity()
export class Log extends IEntity {
  @Column({ length: 256 })
  system: string;

  @Column({ length: 256 })
  subsystem: string;

  @Column({ length: 256 })
  severity: LogSeverity;

  @Column({ type: 'text' })
  message: string;

  @Column({ length: 256, nullable: true })
  category?: string;

  @Column({ nullable: true })
  valid?: boolean;
}
