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
// IDX_b7eda1156aca7b2a1302cdf88f is deliberately migration-owned: it is a covering index
// (INCLUDE "totalBalanceChf", "btcPriceChf") and TypeORM cannot express INCLUDE. Declaring only its
// five key columns would make schema generation DROP it — the loader counts INCLUDE columns in
// pg_index.indkey, so the column count would not match — and recreate it without the INCLUDE,
// silently losing the index-only scan it exists for. Do not re-declare it here.
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

  /**
   * balancesTotal.totalBalanceChf captured at write time from FinancialDataLog rows
   * (LogJobService), so the financial-log chart query can read it without parsing the ~43 KB
   * `message` document. NULL for every other subsystem, and for FinancialDataLog rows written
   * before this column existed until the backfill migration populates them.
   */
  @Column({ type: 'float8', nullable: true })
  totalBalanceChf?: number;

  /**
   * The BTC asset's priceChf entry under assets[<btcAssetId>] in the same FinancialDataLog
   * snapshot, captured at write time for the same reason as totalBalanceChf above.
   */
  @Column({ type: 'float8', nullable: true })
  btcPriceChf?: number;
}
