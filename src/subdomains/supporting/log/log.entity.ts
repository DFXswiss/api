import { IEntity } from 'src/shared/models/entity';
import { Column, Entity } from 'typeorm';

export enum LogSeverity {
  INFO = 'Info',
  WARNING = 'Warning',
  ERROR = 'Error',
}

export type BalancesByTypeMap = Record<string, { plusBalanceChf: number; minusBalanceChf: number }>;

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
  // Access via the typed `balancesByType` getter/setter — never read/write this raw string from
  // business logic.
  @Column({ length: 4000, nullable: true })
  balancesByTypeJson?: string;

  get balancesByType(): BalancesByTypeMap {
    return this.balancesByTypeJson ? JSON.parse(this.balancesByTypeJson) : {};
  }

  set balancesByType(balances: BalancesByTypeMap) {
    this.balancesByTypeJson = JSON.stringify(balances);
  }
}
