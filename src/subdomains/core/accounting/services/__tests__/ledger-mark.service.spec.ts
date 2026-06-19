import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { TestUtil } from 'src/shared/utils/test.util';
import { createCustomLog } from 'src/subdomains/supporting/log/__mocks__/log.entity.mock';
import { Log } from 'src/subdomains/supporting/log/log.entity';
import { LogService } from 'src/subdomains/supporting/log/log.service';
import { LedgerMarkService } from '../ledger-mark.service';

function financialLog(created: Date, assets: Record<string, { priceChf: number }>): Log {
  return createCustomLog({
    system: 'LogService',
    subsystem: 'FinancialDataLog',
    created,
    message: JSON.stringify({ assets }),
  });
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

  it('returns the priceChf of the latest mark ≤ bookingDate (Stufe 2)', async () => {
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

  it('returns undefined when no log row ≤ bookingDate exists (Stufe 3 → needsMark)', async () => {
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

    expect(spy).toHaveBeenCalledWith(new Date('2026-06-01'), true); // dailySample = true
  });

  it('uses the full minute-tick for fresh windows within the threshold', async () => {
    const spy = jest
      .spyOn(logService, 'getFinancialLogs')
      .mockResolvedValue([financialLog(new Date('2026-06-01'), { '5': { priceChf: 50000 } })]);

    await service.preload(new Date('2026-06-01'), new Date('2026-06-01T06:00:00Z')); // < 2 days

    expect(spy).toHaveBeenCalledWith(new Date('2026-06-01'), false); // full tick
  });

  it('trims log rows whose created is strictly after `to` (upper-bound filter before pagination)', async () => {
    jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([
      financialLog(new Date('2026-06-01'), { '5': { priceChf: 50000 } }),
      financialLog(new Date('2026-06-03'), { '5': { priceChf: 52000 } }), // beyond `to` → must be dropped
    ]);

    const cache = await service.preload(new Date('2026-06-01'), new Date('2026-06-02'));

    expect(cache.getMarkAt(5, new Date('2026-06-02'))).toBe(50000); // only the in-window row survives, NOT 52000
  });

  // §5.2 step 3 pagination backstop: when the first bounded read returns more than markPreloadMaxRows rows the service
  // re-loads in created-continuation windows. With markPreloadMaxRows=1 the first read (2 rows) trips the backstop.
  describe('pagination backstop (rows > markPreloadMaxRows)', () => {
    let pagedService: LedgerMarkService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          // override BOTH ledger fields (Object.assign is shallow → a partial ledger would drop the threshold)
          TestUtil.provideConfig({
            ledger: { markPreloadMaxRows: 1, markPreloadDailySampleThresholdDays: 2 } as any,
          }),
          LedgerMarkService,
          { provide: LogService, useValue: logService },
        ],
      }).compile();
      pagedService = module.get<LedgerMarkService>(LedgerMarkService);
    });

    it('re-loads via created-continuation windows and walks the cache across windows', async () => {
      const w1a = financialLog(new Date('2026-06-01T00:00:00Z'), { '5': { priceChf: 50000 } });
      const w1b = financialLog(new Date('2026-06-01T01:00:00Z'), { '5': { priceChf: 51000 } });
      const w2 = financialLog(new Date('2026-06-01T02:00:00Z'), { '5': { priceChf: 52000 } });

      const spy = jest.spyOn(logService, 'getFinancialLogs');
      // first call (the trigger read) returns 2 rows > maxRows(1) → backstop kicks in;
      // paginate then re-queries from the windowStart cursor.
      spy
        .mockResolvedValueOnce([w1a, w1b]) // trigger read: > maxRows → paginate
        .mockResolvedValueOnce([w1a, w1b]) // window 1: 2 rows, lastCreated advances the cursor
        .mockResolvedValueOnce([w2]) // window 2: 1 row < maxRows → loop stops after this window
        .mockResolvedValue([]);

      const cache = await pagedService.preload(new Date('2026-06-01T00:00:00Z'), new Date('2026-06-01T03:00:00Z'));

      // the continuation windows were used (>1 getFinancialLogs call beyond the trigger read)
      expect(spy.mock.calls.length).toBeGreaterThan(1);
      // all three marks made it into the cache built from the paginated rows
      expect(cache.getMarkAt(5, new Date('2026-06-01T00:30:00Z'))).toBe(50000);
      expect(cache.getMarkAt(5, new Date('2026-06-01T01:30:00Z'))).toBe(51000);
      expect(cache.getMarkAt(5, new Date('2026-06-01T02:30:00Z'))).toBe(52000);
    });

    it('stops the pagination loop on the first empty window (no infinite loop)', async () => {
      const trigger = [
        financialLog(new Date('2026-06-01T00:00:00Z'), { '5': { priceChf: 50000 } }),
        financialLog(new Date('2026-06-01T01:00:00Z'), { '5': { priceChf: 51000 } }),
      ];
      const spy = jest
        .spyOn(logService, 'getFinancialLogs')
        .mockResolvedValueOnce(trigger) // trigger read → paginate
        .mockResolvedValueOnce([]); // first window already empty → break immediately

      const cache = await pagedService.preload(new Date('2026-06-01T00:00:00Z'), new Date('2026-06-01T03:00:00Z'));

      expect(spy).toHaveBeenCalledTimes(2); // trigger + one empty window, then break
      expect(cache.getMarkAt(5, new Date('2026-06-01T00:30:00Z'))).toBeUndefined(); // empty window → empty cache
    });

    it('breaks when a window does not advance the created cursor (lastCreated <= windowStart guard)', async () => {
      // every paginated window returns the SAME single timestamp at/below windowStart → the lastCreated<=windowStart
      // guard breaks the loop instead of re-querying the identical window forever.
      const stuck = financialLog(new Date('2026-06-01T00:00:00Z'), { '5': { priceChf: 50000 } });
      const trigger = [
        stuck,
        financialLog(new Date('2026-06-01T00:00:00Z'), { '6': { priceChf: 2 } }), // same created → 2 rows > maxRows
      ];
      const spy = jest
        .spyOn(logService, 'getFinancialLogs')
        .mockResolvedValueOnce(trigger) // trigger read → paginate
        .mockResolvedValue(trigger); // every window returns the same created → cursor cannot advance → break

      const cache = await pagedService.preload(new Date('2026-06-01T00:00:00Z'), new Date('2026-06-01T03:00:00Z'));

      // it must NOT spin: the guard breaks after the first (non-advancing) window
      expect(spy.mock.calls.length).toBeLessThan(5);
      expect(cache.getMarkAt(5, new Date('2026-06-01T00:00:00Z'))).toBe(50000);
    });
  });
});
