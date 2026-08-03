import { Injectable } from '@nestjs/common';
import { LatestBalanceResponseDto } from './dto/financial-log.dto';

/**
 * Holds the single most recent LatestBalanceResponseDto, written once a minute by
 * DashboardFinancialService.refreshLatestBalance from the newest FinancialDataLog entry, and read
 * by GET /v1/dashboard/financial/latest. Exactly one entry, replaced wholesale on every job run:
 * no TTL, no eviction, no size cap.
 *
 * The store is process-local, and so is the job filling it: it carries CronScope.Api, so it runs
 * in whichever process serves the requests reading it. There is one writer per process and no
 * cross-process state to reconcile - both derive the same value from the same row.
 *
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
