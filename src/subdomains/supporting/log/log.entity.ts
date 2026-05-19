import { IEntity } from 'src/shared/models/entity';
import { Column, Entity } from 'typeorm';

export enum LogSeverity {
  INFO = 'Info',
  WARNING = 'Warning',
  ERROR = 'Error',
}

@Entity()
export class Log extends IEntity {
  @Column({ length: 256 })
  system: string;

  @Column({ length: 256 })
  subsystem: string;

  @Column({ length: 256 })
  severity: LogSeverity;

  @Column({ length: 'MAX' })
  message: string;

  @Column({ length: 256, nullable: true })
  category?: string;

  @Column({ nullable: true })
  valid?: boolean;

  // Denormalised aggregates for FinancialDataLog, used by the dashboard chart endpoint to avoid
  // parsing the nvarchar(MAX) message JSON for every row. Nullable so legacy rows fall back to JSON.
  @Column({ type: 'float', nullable: true })
  totalBalanceChf?: number;

  @Column({ type: 'float', nullable: true })
  plusBalanceChf?: number;

  @Column({ type: 'float', nullable: true })
  minusBalanceChf?: number;

  @Column({ type: 'float', nullable: true })
  btcPriceChf?: number;

  // Compact JSON snapshot of the per-financialType plus/minus aggregates (orders of magnitude
  // smaller than the full message), kept separate so the chart endpoint avoids the full parse.
  @Column({ length: 4000, nullable: true })
  balancesByTypeJson?: string;
}
