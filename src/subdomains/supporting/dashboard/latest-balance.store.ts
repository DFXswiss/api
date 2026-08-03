import { Injectable } from '@nestjs/common';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { LatestBalanceResponseDto } from './dto/financial-log.dto';

const LATEST_BALANCE_KEY = 'latest';

/**
 * Holds the single most recent LatestBalanceResponseDto, derived from the newest FinancialDataLog
 * entry and read by GET /v1/dashboard/financial/latest. Exactly one entry, replaced wholesale: no
 * eviction, no size cap.
 *
 * The store is process-local, so every process answering that request needs its own copy - and the
 * job cannot be what puts it there. DashboardFinancialService.refreshLatestBalance is scoped `api`
 * and therefore runs under a lease: with more than one API process, one of them takes the tick and
 * the others do not run the job at all. A store that only the job filled would stay at whatever
 * the losing processes started with.
 *
 * So the read fills it: `get` loads through the loader it is given whenever there is no entry or
 * the one it holds has aged out - what CONTRIBUTING asks of a cache a request path reads. The job keeps
 * the entry warm in the process that took the tick, so requests there never wait for the load.
 */
@Injectable()
export class LatestBalanceStore {
  private readonly cache = new AsyncCache<LatestBalanceResponseDto>(CacheItemResetPeriod.EVERY_1_MINUTE);

  /**
   * Serves the entry, loading it through `load` when there is none or it has aged out. A failing
   * load leaves whatever is there in place and is not raised at the request: an aggregate a minute
   * older answers better than an error, and the refresh below is what reports the failure.
   */
  async get(load: () => Promise<LatestBalanceResponseDto | undefined>): Promise<LatestBalanceResponseDto | undefined> {
    return this.cache.get(LATEST_BALANCE_KEY, load, undefined, true);
  }

  /** Replaces the entry regardless of its age, and raises what `load` throws so the job reports it. */
  async refresh(load: () => Promise<LatestBalanceResponseDto | undefined>): Promise<void> {
    await this.cache.get(LATEST_BALANCE_KEY, load, () => true);
  }
}
