import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Config } from 'src/config/config';
import { TestUtil } from 'src/shared/utils/test.util';
import { Util } from 'src/shared/utils/util';
import { createCustomLog } from 'src/subdomains/supporting/log/__mocks__/log.entity.mock';
import { Log } from 'src/subdomains/supporting/log/log.entity';
import { LogService } from 'src/subdomains/supporting/log/log.service';
import { LedgerMarkService } from '../ledger-mark.service';

let nextLogId = 1;

function financialLog(created: Date, assets: Record<string, { priceChf: number }>): Log {
  return createCustomLog({
    id: nextLogId++,
    system: 'LogService',
    subsystem: 'FinancialDataLog',
    created,
    message: JSON.stringify({ assets }),
  });
}

/**
 * Fake `getFinancialLogs` that honours from/to/limit/after like the repository keyset query.
 * Pagination tests must use this — rigid mockResolvedValueOnce chains ignore limit and hide data-loss bugs.
 * `after` is the id-only cursor (number); filter is rows with id > after.
 */
function fakeGetFinancialLogs(allRows: Log[]) {
  return async (from?: Date, _dailySample?: boolean, to?: Date, limit?: number, after?: number): Promise<Log[]> => {
    let rows = [...allRows].sort((a, b) => {
      const byCreated = a.created.getTime() - b.created.getTime();
      return byCreated !== 0 ? byCreated : a.id - b.id;
    });

    if (from) rows = rows.filter((r) => r.created.getTime() >= from.getTime());
    if (to) rows = rows.filter((r) => r.created.getTime() <= to.getTime());
    if (after != null) rows = rows.filter((r) => r.id > after);
    if (limit != null) rows = rows.slice(0, limit);

    return rows;
  };
}

describe('LedgerMarkService', () => {
  let service: LedgerMarkService;
  let logService: LogService;

  beforeEach(async () => {
    logService = createMock<LogService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [TestUtil.provideConfig(), LedgerMarkService, { provide: LogService, useValue: logService }],
    }).compile();

    service = module.get<LedgerMarkService>(LedgerMarkService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // Major B5 bridge — the youngest available mark (latest ≤ now), memoized, used as the fallback when a historical mark
  // is missing at the booking date.
  describe('getLatestMark (B5 bridge)', () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

    it('returns the youngest available priceChf ≤ now and memoizes the recent-log read', async () => {
      const spy = jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([
        financialLog(daysAgo(2), { '7': { priceChf: 100 } }),
        financialLog(daysAgo(1), { '7': { priceChf: 110 } }), // youngest ≤ now
      ]);

      expect(await service.getLatestMark(7)).toBe(110);
      expect(await service.getLatestMark(7)).toBe(110); // second call reuses the memoized map
      expect(spy).toHaveBeenCalledTimes(1); // no per-call re-query (memoized within the TTL)
    });

    it('returns undefined for an asset absent from every recent log (feedless → caller defers)', async () => {
      jest
        .spyOn(logService, 'getFinancialLogs')
        .mockResolvedValue([financialLog(daysAgo(1), { '7': { priceChf: 110 } })]);

      expect(await service.getLatestMark(999)).toBeUndefined();
    });

    it('requests financial logs with upper bound to = asOf (SQL-side ≤ now)', async () => {
      const spy = jest
        .spyOn(logService, 'getFinancialLogs')
        .mockResolvedValue([financialLog(daysAgo(1), { '7': { priceChf: 110 } })]);

      await service.getLatestMark(7);

      expect(spy).toHaveBeenCalledTimes(1);
      const [, dailySample, to] = spy.mock.calls[0];
      expect(dailySample).toBe(true);
      expect(to).toBeInstanceOf(Date);
      // asOf is captured at call time as new Date(Date.now()); within a few ms of "now"
      expect((to as Date).getTime()).toBeLessThanOrEqual(Date.now());
      expect((to as Date).getTime()).toBeGreaterThan(Date.now() - 5_000);
    });
  });

  // §5.2 — widened last-mark fallback: recovers a delisted/feedless asset's last finite mark ≤ asOf over a window wider
  // than the 2d preload and 5d getLatestMark bridge, memoized per (from, to) so several feedless rows share one read.
  describe('getMarkAtWidened (widened last-mark fallback)', () => {
    const asOf = new Date('2026-07-16');

    afterEach(() => jest.restoreAllMocks()); // fail-safe restore (esp. the Date.now spy in the TTL test) even on failure

    it('returns the last finite mark ≤ asOf even when it predates the 2d/5d windows (delisted asset)', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([
        financialLog(new Date('2026-05-01'), { '5': { priceChf: 3 } }), // ~76d before asOf: outside 2d/5d, inside 90d
        financialLog(new Date('2026-05-10'), { '5': { priceChf: 4 } }), // last finite ≤ asOf
      ]);

      expect(await service.getMarkAtWidened(5, asOf, 90)).toBe(4);
    });

    it('reads over the widened lookback window (from = asOf − lookbackDays, dailySample)', async () => {
      const spy = jest
        .spyOn(logService, 'getFinancialLogs')
        .mockResolvedValue([financialLog(new Date('2026-05-10'), { '5': { priceChf: 4 } })]);

      await service.getMarkAtWidened(5, asOf, 90);

      expect(spy).toHaveBeenCalledWith(Util.daysBefore(90, asOf), true, asOf, Config.ledger.markPreloadMaxRows + 1);
    });

    it('never returns a mark created after asOf', async () => {
      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([
        financialLog(new Date('2026-05-10'), { '5': { priceChf: 4 } }),
        financialLog(new Date('2026-07-18'), { '5': { priceChf: 9 } }), // after asOf → excluded
      ]);

      expect(await service.getMarkAtWidened(5, asOf, 90)).toBe(4);
    });

    it('returns undefined for a truly-unpriced asset in the window (caller stays fail-closed)', async () => {
      jest
        .spyOn(logService, 'getFinancialLogs')
        .mockResolvedValue([financialLog(new Date('2026-05-10'), { '5': { priceChf: 4 } })]);

      expect(await service.getMarkAtWidened(999, asOf, 90)).toBeUndefined();
    });

    it('memoizes per window: several assets over the same (asOf, lookbackDays) trigger a single read', async () => {
      const spy = jest
        .spyOn(logService, 'getFinancialLogs')
        .mockResolvedValue([financialLog(new Date('2026-05-10'), { '5': { priceChf: 4 }, '6': { priceChf: 7 } })]);

      expect(await service.getMarkAtWidened(5, asOf, 90)).toBe(4);
      expect(await service.getMarkAtWidened(6, asOf, 90)).toBe(7); // same window → memoized cache, no re-read
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('does not memoize a rejected load — the next call re-reads (transient-failure recovery, not a permanent wedge)', async () => {
      const spy = jest
        .spyOn(logService, 'getFinancialLogs')
        .mockRejectedValueOnce(new Error('transient DB blip'))
        .mockResolvedValueOnce([financialLog(new Date('2026-05-10'), { '5': { priceChf: 4 } })]);

      await expect(service.getMarkAtWidened(5, asOf, 90)).rejects.toThrow('transient DB blip');
      expect(await service.getMarkAtWidened(5, asOf, 90)).toBe(4); // rejected promise evicted → re-read, not re-thrown
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('expires a still-empty window after the TTL so a later cron retry re-reads and self-heals (no permanent wedge)', async () => {
      const nowSpy = jest.spyOn(Date, 'now');
      const t0 = new Date('2026-07-16T00:00:00Z').getTime();
      nowSpy.mockReturnValue(t0);

      const spy = jest
        .spyOn(logService, 'getFinancialLogs')
        .mockResolvedValueOnce([]) // first widened read: asset still feedless → undefined, must NOT stick forever
        .mockResolvedValueOnce([financialLog(new Date('2026-05-10'), { '5': { priceChf: 4 } })]); // feed restored later

      expect(await service.getMarkAtWidened(5, asOf, 90)).toBeUndefined();
      expect(await service.getMarkAtWidened(5, asOf, 90)).toBeUndefined(); // within TTL → memoized empty, no re-read
      expect(spy).toHaveBeenCalledTimes(1);

      nowSpy.mockReturnValue(t0 + 5 * 60 * 1000 + 1); // a later cron retry, past the 5-min memo TTL
      expect(await service.getMarkAtWidened(5, asOf, 90)).toBe(4); // re-reads and picks up the restored mark
      expect(spy).toHaveBeenCalledTimes(2);

      nowSpy.mockRestore();
    });
  });

  it('returns the priceChf of the latest mark ≤ bookingDate (stage 2)', async () => {
    jest
      .spyOn(logService, 'getFinancialLogs')
      .mockResolvedValue([
        financialLog(new Date('2026-06-01'), { '5': { priceChf: 50000 } }),
        financialLog(new Date('2026-06-02'), { '5': { priceChf: 51000 } }),
        financialLog(new Date('2026-06-03'), { '5': { priceChf: 52000 } }),
      ]);

    const cache = await service.preload(new Date('2026-06-01'), new Date('2026-06-03'));

    expect(cache.getMarkAt(5, new Date('2026-06-02T12:00:00Z'))).toBe(51000); // latest ≤ bookingDate
    expect(cache.getMarkAt(5, new Date('2026-06-03'))).toBe(52000);
  });

  it('returns undefined when no log row ≤ bookingDate exists (stage 3 → needsMark)', async () => {
    jest
      .spyOn(logService, 'getFinancialLogs')
      .mockResolvedValue([financialLog(new Date('2026-06-05'), { '5': { priceChf: 50000 } })]);

    const cache = await service.preload(new Date('2026-06-05'), new Date('2026-06-05'));

    expect(cache.getMarkAt(5, new Date('2026-06-04'))).toBeUndefined(); // no mark before bookingDate
  });

  it('returns undefined when a log row exists but its assets JSON lacks the assetId (Minor R5-5)', async () => {
    jest
      .spyOn(logService, 'getFinancialLogs')
      .mockResolvedValue([financialLog(new Date('2026-06-01'), { '7': { priceChf: 1.0 } })]);

    const cache = await service.preload(new Date('2026-06-01'), new Date('2026-06-01'));

    expect(cache.getMarkAt(999, new Date('2026-06-01'))).toBeUndefined(); // absent assetId → no mark, not 0, not throw
  });

  it('skips non-finite priceChf entries (no phantom 0 mark)', async () => {
    jest
      .spyOn(logService, 'getFinancialLogs')
      .mockResolvedValue([financialLog(new Date('2026-06-01'), { '5': { priceChf: NaN } })]);

    const cache = await service.preload(new Date('2026-06-01'), new Date('2026-06-01'));

    expect(cache.getMarkAt(5, new Date('2026-06-01'))).toBeUndefined();
  });

  it('never throws on malformed message JSON (defensive parse)', async () => {
    jest
      .spyOn(logService, 'getFinancialLogs')
      .mockResolvedValue([createCustomLog({ created: new Date('2026-06-01'), message: 'not-json' })]);

    const cache = await service.preload(new Date('2026-06-01'), new Date('2026-06-01'));

    expect(cache.getMarkAt(5, new Date('2026-06-01'))).toBeUndefined();
  });

  it('uses dailySample when the span exceeds the threshold (bounded preload)', async () => {
    const spy = jest
      .spyOn(logService, 'getFinancialLogs')
      .mockResolvedValue([financialLog(new Date('2026-06-01'), { '5': { priceChf: 50000 } })]);

    await service.preload(new Date('2026-06-01'), new Date('2026-06-10')); // 9 days > threshold 2

    expect(spy).toHaveBeenCalledWith(
      new Date('2026-06-01'),
      true,
      new Date('2026-06-10'),
      Config.ledger.markPreloadMaxRows + 1,
    );
  });

  it('uses the full minute-tick for fresh windows within the threshold', async () => {
    const spy = jest
      .spyOn(logService, 'getFinancialLogs')
      .mockResolvedValue([financialLog(new Date('2026-06-01'), { '5': { priceChf: 50000 } })]);

    await service.preload(new Date('2026-06-01'), new Date('2026-06-01T06:00:00Z')); // < 2 days

    expect(spy).toHaveBeenCalledWith(
      new Date('2026-06-01'),
      false,
      new Date('2026-06-01T06:00:00Z'),
      Config.ledger.markPreloadMaxRows + 1,
    );
  });

  it('passes to and limit (maxRows + 1) on the preload trigger read', async () => {
    const to = new Date('2026-06-02');
    const spy = jest
      .spyOn(logService, 'getFinancialLogs')
      .mockResolvedValue([financialLog(new Date('2026-06-01'), { '5': { priceChf: 50000 } })]);

    await service.preload(new Date('2026-06-01'), to);

    // Upper bound and row cap are enforced in SQL (no post-load JS filter); +1 keeps overflow detectable.
    expect(spy).toHaveBeenCalledWith(new Date('2026-06-01'), false, to, Config.ledger.markPreloadMaxRows + 1);
  });

  // §5.2 step 3 pagination backstop: when the first bounded read returns more than markPreloadMaxRows rows the service
  // continues via keyset pages over id (created resolved in-DB). With markPreloadMaxRows=1 the first read (2 rows)
  // trips the backstop; the probe's first maxRows rows are reused as page 1.
  describe('pagination backstop (rows > markPreloadMaxRows)', () => {
    let pagedService: LedgerMarkService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          // override BOTH ledger fields (Object.assign is shallow → a partial ledger would drop the threshold)
          TestUtil.provideConfig({
            ledger: { markPreloadMaxRows: 1, markPreloadDailySampleThresholdDays: 2 },
          }),
          LedgerMarkService,
          { provide: LogService, useValue: logService },
        ],
      }).compile();
      pagedService = module.get<LedgerMarkService>(LedgerMarkService);
    });

    it('re-loads via keyset pages and walks the cache across windows', async () => {
      const w1a = financialLog(new Date('2026-06-01T00:00:00Z'), { '5': { priceChf: 50000 } });
      const w1b = financialLog(new Date('2026-06-01T01:00:00Z'), { '5': { priceChf: 51000 } });
      const w2 = financialLog(new Date('2026-06-01T02:00:00Z'), { '5': { priceChf: 52000 } });

      const spy = jest.spyOn(logService, 'getFinancialLogs').mockImplementation(fakeGetFinancialLogs([w1a, w1b, w2]));

      const cache = await pagedService.preload(new Date('2026-06-01T00:00:00Z'), new Date('2026-06-01T03:00:00Z'));

      // the continuation windows were used (>1 getFinancialLogs call beyond the trigger read)
      expect(spy.mock.calls.length).toBeGreaterThan(1);
      // all three marks made it into the cache built from the paginated rows
      expect(cache.getMarkAt(5, new Date('2026-06-01T00:30:00Z'))).toBe(50000);
      expect(cache.getMarkAt(5, new Date('2026-06-01T01:30:00Z'))).toBe(51000);
      expect(cache.getMarkAt(5, new Date('2026-06-01T02:30:00Z'))).toBe(52000);
    });

    // Regression B: created-only continuation with maxRows=1 re-fetched page-1's sole row forever and dropped the rest.
    it('keeps every row when markPreloadMaxRows is 1 (no silent drop of the second created)', async () => {
      const r1 = financialLog(new Date('2026-06-01T00:00:00Z'), { '5': { priceChf: 50000 } });
      const r2 = financialLog(new Date('2026-06-01T01:00:00Z'), { '5': { priceChf: 51000 } });

      jest.spyOn(logService, 'getFinancialLogs').mockImplementation(fakeGetFinancialLogs([r1, r2]));

      const cache = await pagedService.preload(new Date('2026-06-01T00:00:00Z'), new Date('2026-06-01T03:00:00Z'));

      expect(cache.getMarkAt(5, new Date('2026-06-01T00:30:00Z'))).toBe(50000);
      expect(cache.getMarkAt(5, new Date('2026-06-01T01:30:00Z'))).toBe(51000);
    });

    it('excludes rows with created after to from the cache (SQL upper bound is respected)', async () => {
      const inRange = financialLog(new Date('2026-06-01T00:00:00Z'), { '5': { priceChf: 50000 } });
      const alsoInRange = financialLog(new Date('2026-06-01T01:00:00Z'), { '5': { priceChf: 51000 } });
      const afterTo = financialLog(new Date('2026-06-01T04:00:00Z'), { '5': { priceChf: 99999 } });
      const to = new Date('2026-06-01T03:00:00Z');

      const spy = jest
        .spyOn(logService, 'getFinancialLogs')
        .mockImplementation(fakeGetFinancialLogs([inRange, alsoInRange, afterTo]));

      const cache = await pagedService.preload(new Date('2026-06-01T00:00:00Z'), to);

      expect(cache.getMarkAt(5, new Date('2026-06-01T00:30:00Z'))).toBe(50000);
      expect(cache.getMarkAt(5, new Date('2026-06-01T01:30:00Z'))).toBe(51000);
      // too-late row must not leak into the cache (lookup at/after its created still shows the last in-range mark)
      expect(cache.getMarkAt(5, afterTo.created)).toBe(51000);
      expect(cache.getMarkAt(5, afterTo.created)).not.toBe(99999);
      // every call passes the same upper bound
      for (const call of spy.mock.calls) {
        expect(call[2]).toEqual(to);
      }
    });

    it('returns an empty cache when no financial logs fall in the window', async () => {
      const spy = jest.spyOn(logService, 'getFinancialLogs').mockImplementation(fakeGetFinancialLogs([]));

      const cache = await pagedService.preload(new Date('2026-06-01T00:00:00Z'), new Date('2026-06-01T03:00:00Z'));

      expect(spy).toHaveBeenCalledTimes(1); // trigger only — empty, no pagination
      expect(cache.getMarkAt(5, new Date('2026-06-01T00:30:00Z'))).toBeUndefined();
    });

    // §5.2 precision fix: log.created is timestamp(6) in Postgres (microsecond precision) but JS `Date`
    // only carries milliseconds - reading a row truncates e.g. ...841802 -> ...841. A (created, id)-Date
    // cursor sent back to the DB compares this truncated value against the SAME row's full-precision
    // column, and ...841802 > ...841000 is true, so the row that WAS the cursor reappears (duplicate /
    // infinite loop at markPreloadMaxRows=1). The id-only cursor removes the Date round-trip entirely:
    // the DB resolves `created` for :afterId itself, at full precision - this failure mode becomes
    // structurally impossible.
    describe('microsecond-precision cursor (regression: a Date-based cursor duplicates the cursor row)', () => {
      it('the new id-only cursor never re-includes the cursor row: rows sharing a millisecond are each emitted exactly once, pagination terminates', async () => {
        // All three rows carry the SAME JS-representable millisecond. In Postgres they differ only in the
        // microsecond remainder, which a JS Date cannot hold — so a Date-based cursor could not tell them
        // apart and re-included the cursor row. The id-only cursor is immune by construction.
        const sameMs = new Date('2026-07-29T11:51:46.841Z').getTime();
        const rows = [
          financialLog(new Date(sameMs), { '5': { priceChf: 1 } }),
          financialLog(new Date(sameMs), { '6': { priceChf: 2 } }),
          financialLog(new Date(sameMs), { '7': { priceChf: 3 } }),
        ];

        // pagedService here = the pagination-backstop describe-block's service instance with
        // markPreloadMaxRows = 1 (see that block's beforeEach) - reuse it, do not rebuild a separate module.
        const spy = jest.spyOn(logService, 'getFinancialLogs').mockImplementation(fakeGetFinancialLogs(rows));

        const cache = await pagedService.preload(new Date(sameMs), new Date(sameMs));

        expect(cache.getMarkAt(5, new Date(sameMs))).toBe(1);
        expect(cache.getMarkAt(6, new Date(sameMs))).toBe(2);
        expect(cache.getMarkAt(7, new Date(sameMs))).toBe(3);
        expect(spy.mock.calls.length).toBeLessThan(10); // terminates - no infinite loop

        // structural guarantee: the cursor argument passed to getFinancialLogs is always a plain id
        // (number), never a Date - so there is no JS-truncated timestamp for the DB to compare at all.
        for (const call of spy.mock.calls) {
          const afterArg = call[4];
          if (afterArg !== undefined) expect(typeof afterArg).toBe('number');
        }
      });
    });
  });

  // SQL limit can end a page mid-group of rows that share the same `created`; keyset after id
  // must continue past the tie without re-emitting seen rows or dropping the rest of the group.
  describe('pagination mid-group created tie (SQL limit cuts a same-created group)', () => {
    let pagedService: LedgerMarkService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TestUtil.provideConfig({
            ledger: { markPreloadMaxRows: 2, markPreloadDailySampleThresholdDays: 2 },
          }),
          LedgerMarkService,
          { provide: LogService, useValue: logService },
        ],
      }).compile();
      pagedService = module.get<LedgerMarkService>(LedgerMarkService);
    });

    // Regression A: a same-created group larger than maxRows used to stall (newRows empty) and drop remaining rows.
    it('does not lose rows when a same-created group is larger than maxRows', async () => {
      const batchStart = new Date('2026-06-01T00:00:00Z');
      const to = new Date('2026-06-01T23:59:59Z');
      const sameCreated = new Date('2026-06-01T12:00:00Z');
      const r1 = financialLog(sameCreated, { '5': { priceChf: 1 } });
      const r2 = financialLog(sameCreated, { '6': { priceChf: 2 } });
      const r3 = financialLog(sameCreated, { '7': { priceChf: 3 } });
      const r4 = financialLog(new Date('2026-06-01T18:00:00Z'), { '8': { priceChf: 4 } });

      const spy = jest.spyOn(logService, 'getFinancialLogs').mockImplementation(fakeGetFinancialLogs([r1, r2, r3, r4]));

      const cache = await pagedService.preload(batchStart, to);

      // all four rows land — three-way created tie + later distinct created
      expect(cache.getMarkAt(5, to)).toBe(1);
      expect(cache.getMarkAt(6, to)).toBe(2);
      expect(cache.getMarkAt(7, to)).toBe(3);
      expect(cache.getMarkAt(8, to)).toBe(4);
      // finite number of calls — keyset advances; no infinite re-query of the tie-group
      expect(spy.mock.calls.length).toBeLessThan(10);
    });

    // Overflow reuse: probe reads maxRows+1, reuses first maxRows as page 1, continues from that last id.
    // Without reuse: 1 probe + 3 pages = 4 calls. With reuse: 1 probe + 2 continuation pages = 3.
    it('reuses the overflow probe as page 1 (no double-read of the first maxRows rows)', async () => {
      const batchStart = new Date('2026-06-01T00:00:00Z');
      const to = new Date('2026-06-01T23:59:59Z');
      const r1 = financialLog(new Date('2026-06-01T01:00:00Z'), { '5': { priceChf: 10 } });
      const r2 = financialLog(new Date('2026-06-01T02:00:00Z'), { '5': { priceChf: 20 } });
      const r3 = financialLog(new Date('2026-06-01T03:00:00Z'), { '5': { priceChf: 30 } });
      const r4 = financialLog(new Date('2026-06-01T04:00:00Z'), { '5': { priceChf: 40 } });
      const r5 = financialLog(new Date('2026-06-01T05:00:00Z'), { '5': { priceChf: 50 } });

      const spy = jest
        .spyOn(logService, 'getFinancialLogs')
        .mockImplementation(fakeGetFinancialLogs([r1, r2, r3, r4, r5]));

      const cache = await pagedService.preload(batchStart, to);

      // all five marks land at their respective timestamps
      expect(cache.getMarkAt(5, new Date('2026-06-01T01:30:00Z'))).toBe(10);
      expect(cache.getMarkAt(5, new Date('2026-06-01T02:30:00Z'))).toBe(20);
      expect(cache.getMarkAt(5, new Date('2026-06-01T03:30:00Z'))).toBe(30);
      expect(cache.getMarkAt(5, new Date('2026-06-01T04:30:00Z'))).toBe(40);
      expect(cache.getMarkAt(5, new Date('2026-06-01T05:30:00Z'))).toBe(50);
      // markPreloadMaxRows=2: probe (3) + page after r2 (r3,r4) + page after r4 (r5) = 3 calls
      expect(spy.mock.calls.length).toBe(3);
    });
  });

  // dailySample=true pagination path: span > threshold so both getFinancialLogs branches' cursor logic is exercised
  // under overflow (maxRows small enough that multi-page keyset runs).
  describe('pagination with dailySample=true (span > markPreloadDailySampleThresholdDays)', () => {
    let pagedService: LedgerMarkService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          // BOTH ledger fields required (shallow merge); low threshold so a multi-day span forces dailySample
          TestUtil.provideConfig({
            ledger: { markPreloadMaxRows: 1, markPreloadDailySampleThresholdDays: 2 },
          }),
          LedgerMarkService,
          { provide: LogService, useValue: logService },
        ],
      }).compile();
      pagedService = module.get<LedgerMarkService>(LedgerMarkService);
    });

    it('paginates with dailySample=true on overflow and keeps every mark', async () => {
      // 9-day span > threshold 2 → dailySample true; 3 rows > maxRows 1 → multi-page keyset
      const batchStart = new Date('2026-06-01T00:00:00Z');
      const to = new Date('2026-06-10T00:00:00Z');
      const r1 = financialLog(new Date('2026-06-01T00:00:00Z'), { '5': { priceChf: 100 } });
      const r2 = financialLog(new Date('2026-06-05T00:00:00Z'), { '5': { priceChf: 200 } });
      const r3 = financialLog(new Date('2026-06-09T00:00:00Z'), { '5': { priceChf: 300 } });

      const spy = jest.spyOn(logService, 'getFinancialLogs').mockImplementation(fakeGetFinancialLogs([r1, r2, r3]));

      const cache = await pagedService.preload(batchStart, to);

      expect(cache.getMarkAt(5, new Date('2026-06-01T12:00:00Z'))).toBe(100);
      expect(cache.getMarkAt(5, new Date('2026-06-05T12:00:00Z'))).toBe(200);
      expect(cache.getMarkAt(5, new Date('2026-06-09T12:00:00Z'))).toBe(300);
      // every call (probe + continuation pages) must request dailySample
      expect(spy.mock.calls.length).toBeGreaterThan(1);
      for (const call of spy.mock.calls) {
        expect(call[1]).toBe(true);
      }
    });
  });
});
