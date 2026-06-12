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
});
