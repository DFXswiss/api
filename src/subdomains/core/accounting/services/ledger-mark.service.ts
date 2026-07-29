import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { FinanceLog } from 'src/subdomains/supporting/log/dto/log.dto';
import { Log } from 'src/subdomains/supporting/log/log.entity';
import { FinancialLogAssetPrice } from 'src/subdomains/supporting/log/log.repository';
import { LogService } from 'src/subdomains/supporting/log/log.service';

interface MarkPoint {
  created: Date;
  priceChf: number;
}

// Major B5 bridge: bounded recent-log window scanned for the youngest available mark (latest ≤ now) per asset, and a
// short memoization TTL so a wedge-heavy batch (many rows missing a historical mark) does not re-query the feed per row.
const LATEST_MARK_LOOKBACK_DAYS = 5;
const LATEST_MARK_TTL_MS = 5 * 60 * 1000;
// same self-healing TTL for the widened last-mark memo (getMarkAtWidened): its (from,to) key is byte-stable across every
// 5-min cutover cron retry (the snapshot date is pinned), so without expiry a once-empty window — a still-feedless asset
// at preload time — would be memoized forever and wedge the cutover past the documented "retry when the feed is back"
// recovery. Expiry lets a later retry re-read and pick up a backfilled historical mark; within one run (seconds) the
// memo still dedupes several feedless rows sharing the window.
const WIDENED_MARK_TTL_MS = LATEST_MARK_TTL_MS;

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
  // dedupes the preload when several feedless cutover rows share a window (one pinned snapshot → 1-2 keys, negligible).
  // Carries a load timestamp so a still-empty result expires after WIDENED_MARK_TTL_MS (self-heals across cron retries)
  // rather than sticking forever on this process-lifetime singleton.
  private readonly widenedCaches = new Map<string, { cache: Promise<LedgerMarkCache>; loadedAt: number }>();

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
  // Stays on full getFinancialLogs (not the price projection): does not use buildMarkMap / preload pagination and only
  // needs a flat Map<assetId, priceChf> over a short daily-sampled window.
  private async getLatestMarks(): Promise<Map<number, number>> {
    const now = Date.now();
    if (this.latestMarks && now - this.latestMarks.loadedAt < LATEST_MARK_TTL_MS) return this.latestMarks.map;

    const asOf = new Date(now);
    const rows = await this.logService.getFinancialLogs(Util.daysBefore(LATEST_MARK_LOOKBACK_DAYS, asOf), true, asOf);

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
    const now = Date.now();

    let entry = this.widenedCaches.get(key);
    // Expire a stale memo (including a successful-but-still-empty one) after the TTL so a later cron retry re-reads and
    // can pick up a backfilled historical mark — the pinned-snapshot key never changes, so a stuck empty result would
    // otherwise wedge the cutover forever (asymmetry vs the TTL'd latestMarks bridge).
    if (!entry || now - entry.loadedAt >= WIDENED_MARK_TTL_MS) {
      // do NOT memoize a transient failure either: a rejected preload is evicted immediately so the next cron retry
      // re-reads (the widened read is a larger, possibly-paginated query than the 2d preload — a blip must not wedge).
      // Guard the eviction by loadedAt so a late-rejecting stale load never deletes a fresher entry a retry installed.
      const loadedAt = now;
      entry = {
        cache: this.preload(from, asOf).catch((e) => {
          if (this.widenedCaches.get(key)?.loadedAt === loadedAt) this.widenedCaches.delete(key);
          throw e;
        }),
        loadedAt,
      };
      this.widenedCaches.set(key, entry);
    }
    return (await entry.cache).getMarkAt(assetId, asOf);
  }

  /**
   * Bounded preload (§5.2, Hard Constraint #4): always limited by (batchStartDate, to) and maxRows.
   * Order is fixed — dailySample decision FIRST (avoids loading the full minute-tick), THEN upper-bound
   * trimming, THEN the maxRows pagination backstop (keyset over log id; created resolved in-DB).
   *
   * Hot path (dailySample=false): SQL projects priceChf only (getFinancialLogAssetPrices).
   * Rare long-window path (dailySample=true): still getFinancialLogs + local expansion to the same projection type.
   */
  async preload(batchStartDate: Date, to: Date): Promise<LedgerMarkCache> {
    const spanDays = Util.daysDiff(batchStartDate, to);
    const dailySample = spanDays > Config.ledger.markPreloadDailySampleThresholdDays;
    const maxRows = this.getMarkPreloadMaxRows();

    // +1 so unique log-id count > maxRows can still detect overflow when SQL already caps at maxRows log rows
    const probeRows = await this.loadAssetPrices(batchStartDate, to, dailySample, maxRows + 1);

    const rows =
      this.uniqueLogIds(probeRows).length > maxRows
        ? await this.paginate(batchStartDate, to, dailySample, this.takeCompleteLogGroups(probeRows, maxRows))
        : probeRows;

    return new LedgerMarkCache(this.buildMarkMap(rows));
  }

  // Keyset pages over log id; never load everything into one heap (§5.2 step 3).
  // Overflow/page sizes are measured in distinct logId groups (one FinancialDataLog snapshot), not flattened
  // asset-result length — slicing by array index would cut mid-snapshot and drop assets silently.
  // `firstPage` reuses the complete log groups preload() already read via the overflow probe.
  private async paginate(
    batchStartDate: Date,
    to: Date,
    dailySample: boolean,
    firstPage: FinancialLogAssetPrice[],
  ): Promise<FinancialLogAssetPrice[]> {
    const maxRows = this.getMarkPreloadMaxRows();
    const result: FinancialLogAssetPrice[] = [...firstPage];
    const firstPageLogIds = this.uniqueLogIds(firstPage);
    let after: number | undefined = firstPageLogIds[firstPageLogIds.length - 1];

    // Keyset continuation: each page starts strictly after the last returned log id.
    while (true) {
      const window = await this.loadAssetPrices(batchStartDate, to, dailySample, maxRows, after);
      if (!window.length) break;

      result.push(...window);
      const windowLogIds = this.uniqueLogIds(window);
      if (windowLogIds.length < maxRows) break;

      after = windowLogIds[windowLogIds.length - 1];
    }

    return result;
  }

  // Hot path: SQL projection. dailySample path: full logs (day-group SQL not reimplemented) expanded locally.
  private async loadAssetPrices(
    from: Date,
    to: Date,
    dailySample: boolean,
    limit?: number,
    after?: number,
  ): Promise<FinancialLogAssetPrice[]> {
    if (dailySample) {
      const logs = await this.logService.getFinancialLogs(from, true, to, limit, after);
      return logs.flatMap((row) => this.rowToAssetPrices(row));
    }
    return this.logService.getFinancialLogAssetPrices(from, to, limit, after);
  }

  // Expand one Log into the same projection shape as getFinancialLogAssetPrices (dailySample adapter only).
  // Mirrors the repository's LEFT JOIN LATERAL: every log row must yield at least one result row so that
  // uniqueLogIds/overflow-detection below count log rows actually read, not just the ones carrying a usable
  // mark (see PR review Finding 1+2) — an empty/absent `assets` object still emits one all-null placeholder
  // row, and each present asset key emits its own row with assetId/priceChf nulled per-field when unusable
  // (non-numeric key / non-finite price), rather than being skipped.
  private rowToAssetPrices(row: Log): FinancialLogAssetPrice[] {
    const assets = this.parseAssets(row.message);
    const entries = assets ? Object.entries(assets) : [];

    if (!entries.length) {
      return [{ created: row.created, assetId: null, priceChf: null, logId: row.id }];
    }

    return entries.map(([assetIdKey, assetLog]) => {
      const priceChf = assetLog?.priceChf;
      return {
        created: row.created,
        assetId: /^[0-9]+$/.test(assetIdKey) ? Number(assetIdKey) : null,
        priceChf: typeof priceChf === 'number' && Number.isFinite(priceChf) ? priceChf : null,
        logId: row.id,
      };
    });
  }

  // Distinct logIds in first-seen order (SQL keeps all assets of one log contiguous).
  // logId is present on every projection row, including null-price placeholders, so this counts log rows
  // actually read — not only those that carried a usable mark (Finding 1+2).
  private uniqueLogIds(rows: FinancialLogAssetPrice[]): number[] {
    const ids: number[] = [];
    const seen = new Set<number>();
    for (const row of rows) {
      if (seen.has(row.logId)) continue;
      seen.add(row.logId);
      ids.push(row.logId);
    }
    return ids;
  }

  // Keep every projected asset belonging to the first `maxLogRows` distinct logIds (no mid-group cut).
  private takeCompleteLogGroups(rows: FinancialLogAssetPrice[], maxLogRows: number): FinancialLogAssetPrice[] {
    const allowed = new Set(this.uniqueLogIds(rows).slice(0, maxLogRows));
    return rows.filter((row) => allowed.has(row.logId));
  }

  // Fail loud on a non-positive / non-integer markPreloadMaxRows (e.g. LEDGER_MARK_PRELOAD_MAX_ROWS=0 or
  // a broken env parse): LIMIT 0 / empty first page would otherwise silently build an empty cache.
  private getMarkPreloadMaxRows(): number {
    const value = Config.ledger.markPreloadMaxRows;
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`Invalid LEDGER_MARK_PRELOAD_MAX_ROWS: expected a positive integer, got ${String(value)}`);
    }
    return value;
  }

  private buildMarkMap(rows: FinancialLogAssetPrice[]): Map<number, MarkPoint[]> {
    const marks = new Map<number, MarkPoint[]>();

    for (const row of rows) {
      // Repo / rowToAssetPrices keep a row per read log even without a usable mark (assetId/priceChf
      // null) so overflow detection and keyset pagination count log rows correctly — skip those here.
      // Number.isFinite is kept as a second line of defence: the repository already nulls NaN/Infinity,
      // but a mark of NaN would silently corrupt a valuation, so it must not depend on one guard alone.
      if (row.assetId == null || !Number.isFinite(row.priceChf)) continue;

      const points = marks.get(row.assetId) ?? [];
      points.push({ created: row.created, priceChf: row.priceChf });
      marks.set(row.assetId, points);
    }

    // rows arrive ascending by created (repository order); keep lists sorted for binary search
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
