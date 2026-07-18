import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { FinanceLog } from 'src/subdomains/supporting/log/dto/log.dto';
import { Log } from 'src/subdomains/supporting/log/log.entity';
import { LogService } from 'src/subdomains/supporting/log/log.service';

interface MarkPoint {
  created: Date;
  priceChf: number;
}

// Major B5 bridge: bounded recent-log window scanned for the youngest available mark (latest ≤ now) per asset, and a
// short memoization TTL so a wedge-heavy batch (many rows missing a historical mark) does not re-query the feed per row.
const LATEST_MARK_LOOKBACK_DAYS = 5;
const LATEST_MARK_TTL_MS = 5 * 60 * 1000;

/**
 * Per-run mark cache (§5.2). Holds `Map<assetId, MarkPoint[]>` (each list sorted ascending by `created`)
 * and resolves `getMarkAt(assetId, bookingDate)` = latest mark ≤ bookingDate via binary search.
 *
 * Two distinct "no mark" cases both return undefined (Caller sets needsMark=true, never priceChf=0):
 *  (1) no log row ≤ bookingDate; (2) a log row exists but its assets JSON lacks the assetId (§5.2 Minor R5-5).
 */
export class LedgerMarkCache {
  constructor(private readonly marks: Map<number, MarkPoint[]>) {}

  // never feed a derived display priceChf into this comparison (§4.5 Minor R7-5)
  getMarkAt(assetId: number, bookingDate: Date): number | undefined {
    const points = this.marks.get(assetId);
    if (!points?.length) return undefined;

    // binary search: latest point with created <= bookingDate
    let lo = 0;
    let hi = points.length - 1;
    let result: MarkPoint | undefined;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].created.getTime() <= bookingDate.getTime()) {
        result = points[mid];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return result?.priceChf;
  }
}

@Injectable()
export class LedgerMarkService {
  constructor(private readonly logService: LogService) {}

  // memoized youngest-mark-per-asset map (≤ now) for the B5 bridge; refreshed at most once per LATEST_MARK_TTL_MS
  private latestMarks?: { map: Map<number, number>; loadedAt: number };

  // §5.2 — per-window LedgerMarkCache memo for the widened last-mark fallback (getMarkAtWidened), keyed `${from}:${to}`;
  // dedupes the preload when several feedless cutover rows share a window (one pinned snapshot → 1-2 keys, negligible)
  private readonly widenedCaches = new Map<string, Promise<LedgerMarkCache>>();

  /**
   * §5.2 Major B5 bridge — the youngest available mark for an asset (latest FinancialDataLog priceChf ≤ now), from a
   * bounded recent-log read. Used ONLY as the documented fallback when the per-batch cache has no mark AT a historical
   * bookingDate: the leg is booked with this provisional CHF value so a mixed tx balances, needsMark stays true, and
   * the daily mark-to-market job corrects the basis to the real rate. Returns undefined ONLY when the asset has NO
   * finite priceChf in any recent log (never fed / feedless) — the caller then DEFERS the row (skip without advancing
   * the watermark) rather than book a wrong value: a feedless asset is a genuine data state, not a price-timing gap.
   */
  async getLatestMark(assetId: number): Promise<number | undefined> {
    return (await this.getLatestMarks()).get(assetId);
  }

  // bounded, memoized youngest-mark map (≤ now). Ascending by created → the last finite write per asset wins → youngest.
  private async getLatestMarks(): Promise<Map<number, number>> {
    const now = Date.now();
    if (this.latestMarks && now - this.latestMarks.loadedAt < LATEST_MARK_TTL_MS) return this.latestMarks.map;

    const asOf = new Date(now);
    const rows = (
      await this.logService.getFinancialLogs(Util.daysBefore(LATEST_MARK_LOOKBACK_DAYS, asOf), true)
    ).filter((r) => r.created.getTime() <= asOf.getTime());

    const map = new Map<number, number>();
    for (const row of rows) {
      const assets = this.parseAssets(row.message);
      if (!assets) continue;
      for (const [assetIdKey, assetLog] of Object.entries(assets)) {
        if (Number.isFinite(assetLog?.priceChf)) map.set(+assetIdKey, assetLog.priceChf);
      }
    }

    this.latestMarks = { map, loadedAt: now };
    return map;
  }

  /**
   * §5.2 — the last finite mark ≤ `asOf` for one asset, over a window WIDENED past the ~2-day preload cache and the
   * 5-day getLatestMark bridge. A cutover owed / manual-debt opening whose asset is delisted carries no mark in those
   * short windows and would fail loud and wedge the run — yet the (≤90d-old) owed row's asset was necessarily priced
   * when it was created, so its last finite priceChf sits within `lookbackDays`. Reuses the canonical preload →
   * getMarkAt (binary-search "latest finite priceChf ≤ asOf") path; the per-window cache is memoized so several
   * feedless rows sharing a window trigger a single read. Returns undefined ONLY for a truly-unpriced asset → the
   * caller stays fail-closed (never a silent native-0).
   */
  async getMarkAtWidened(assetId: number, asOf: Date, lookbackDays: number): Promise<number | undefined> {
    const from = Util.daysBefore(lookbackDays, asOf);
    const key = `${from.getTime()}:${asOf.getTime()}`;
    let cache = this.widenedCaches.get(key);
    if (!cache) {
      cache = this.preload(from, asOf);
      this.widenedCaches.set(key, cache);
    }
    return (await cache).getMarkAt(assetId, asOf);
  }

  /**
   * Bounded preload (§5.2, Hard Constraint #4): always limited by (batchStartDate, to) and maxRows.
   * Order is fixed — dailySample decision FIRST (avoids loading the full minute-tick), THEN upper-bound
   * trimming, THEN the maxRows pagination backstop.
   */
  async preload(batchStartDate: Date, to: Date): Promise<LedgerMarkCache> {
    const spanDays = Util.daysDiff(batchStartDate, to);
    const dailySample = spanDays > Config.ledger.markPreloadDailySampleThresholdDays;

    let rows = await this.logService.getFinancialLogs(batchStartDate, dailySample);
    rows = rows.filter((r) => r.created.getTime() <= to.getTime());

    if (rows.length > Config.ledger.markPreloadMaxRows) {
      rows = await this.paginate(batchStartDate, to, dailySample);
    }

    return new LedgerMarkCache(this.buildMarkMap(rows));
  }

  // created-continuation windows; never load everything into one heap (§5.2 step 3)
  private async paginate(batchStartDate: Date, to: Date, dailySample: boolean): Promise<Log[]> {
    const result: Log[] = [];
    let windowStart = batchStartDate;

    while (windowStart.getTime() <= to.getTime()) {
      const window = (await this.logService.getFinancialLogs(windowStart, dailySample)).filter(
        (r) => r.created.getTime() <= to.getTime(),
      );
      if (!window.length) break;

      result.push(...window);
      const lastCreated = window[window.length - 1].created;
      if (window.length < Config.ledger.markPreloadMaxRows || lastCreated.getTime() <= windowStart.getTime()) break;

      windowStart = new Date(lastCreated.getTime() + 1);
    }

    return result;
  }

  private buildMarkMap(rows: Log[]): Map<number, MarkPoint[]> {
    const marks = new Map<number, MarkPoint[]>();

    for (const row of rows) {
      // tolerate parse/shape issues defensively — never throw, mirrors log-job getJsonValue
      const assets = this.parseAssets(row.message);
      if (!assets) continue;

      for (const [assetIdKey, assetLog] of Object.entries(assets)) {
        const priceChf = assetLog?.priceChf;
        if (!Number.isFinite(priceChf)) continue;

        const assetId = +assetIdKey;
        const points = marks.get(assetId) ?? [];
        points.push({ created: row.created, priceChf });
        marks.set(assetId, points);
      }
    }

    // rows arrive ascending by created (getFinancialLogs order); keep lists sorted for binary search
    for (const points of marks.values()) {
      points.sort((a, b) => a.created.getTime() - b.created.getTime());
    }

    return marks;
  }

  private parseAssets(message: string): FinanceLog['assets'] | undefined {
    try {
      return (JSON.parse(message) as FinanceLog).assets;
    } catch {
      return undefined;
    }
  }
}
