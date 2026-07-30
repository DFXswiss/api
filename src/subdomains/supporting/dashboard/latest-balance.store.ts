import { Injectable } from '@nestjs/common';
import { LatestBalanceResponseDto } from './dto/financial-log.dto';

/**
 * Holds the single most recent LatestBalanceResponseDto, written once a minute by LogJobService
 * right after it writes the FinancialDataLog entry the value is derived from, and read by
 * GET /v1/dashboard/financial/latest. Exactly one entry, replaced wholesale on every job run: no
 * TTL, no eviction, no size cap. There is only ever one API process instance and the writing cron
 * job holds a lock, so there is never more than one writer and no cross-instance state to reconcile.
 * Empty (undefined) until the first job run after process start; the read side must not fall back
 * to the database in that window (see DashboardFinancialService.getLatestBalance).
 */
@Injectable()
export class LatestBalanceStore {
  private value: LatestBalanceResponseDto | undefined;

  get(): LatestBalanceResponseDto | undefined {
    return this.value;
  }

  set(value: LatestBalanceResponseDto): void {
    this.value = value;
  }
}
