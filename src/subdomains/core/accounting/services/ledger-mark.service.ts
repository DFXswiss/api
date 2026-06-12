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
