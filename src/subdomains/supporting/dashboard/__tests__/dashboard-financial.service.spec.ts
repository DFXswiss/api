import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { RefRewardService } from 'src/subdomains/core/referral/reward/services/ref-reward.service';
import { Log } from '../../log/log.entity';
import { FinancialLogSummary } from '../../log/log.repository';
import { LogService } from '../../log/log.service';
import { DashboardFinancialService } from '../dashboard-financial.service';

describe('DashboardFinancialService', () => {
  let service: DashboardFinancialService;
  let logService: LogService;
  let assetService: AssetService;

  beforeEach(async () => {
    logService = createMock<LogService>();
    assetService = createMock<AssetService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardFinancialService,
        { provide: LogService, useValue: logService },
        { provide: AssetService, useValue: assetService },
        { provide: RefRewardService, useValue: createMock<RefRewardService>() },
      ],
    }).compile();

    service = module.get<DashboardFinancialService>(DashboardFinancialService);
  });

  function mapEntry(changes: unknown) {
    const log = { created: new Date(), message: JSON.stringify({ changes }) } as Log;
    return (service as any).mapChangesLogToEntry(log);
  }

  it('maps the Scrypt and MEXC minus blocks from a new change log', () => {
    const entry = mapEntry({
      minus: {
        scrypt: { total: 229.67, withdraw: 0, trading: 229.67 },
        mexc: { total: 23.22, withdraw: 5, trading: 18.22 },
      },
    });

    expect(entry.minus.scrypt).toEqual({ total: 229.67, withdraw: 0, trading: 229.67 });
    expect(entry.minus.mexc).toEqual({ total: 23.22, withdraw: 5, trading: 18.22 });
  });

  it('defaults Scrypt and MEXC to zero for a historical log without those keys (backward compatibility)', () => {
    const entry = mapEntry({
      minus: {
        bank: 10,
        kraken: { total: 5, withdraw: 2, trading: 3 },
        binance: { total: 7, withdraw: 1, trading: 6 },
      },
    });

    expect(entry.minus.scrypt).toEqual({ total: 0, withdraw: 0, trading: 0 });
    expect(entry.minus.mexc).toEqual({ total: 0, withdraw: 0, trading: 0 });
    expect(entry.minus.binance).toEqual({ total: 7, withdraw: 1, trading: 6 });
  });

  describe('mapSummaryToEntry (fxPnlChf exposure)', () => {
    const summaryWith = (overrides: Partial<FinancialLogSummary>): FinancialLogSummary => ({
      created: new Date('2026-07-14T00:00:00Z'),
      id: 1,
      totalBalanceChf: 100,
      plusBalanceChf: 100,
      minusBalanceChf: 0,
      fxPnlChf: null,
      btcPriceChf: 0,
      balancesByType: {},
      ...overrides,
    });

    it('exposes the fxPnlChf written into the log entry, preserving a negative value', () => {
      const entry = service['mapSummaryToEntry'](
        summaryWith({ totalBalanceChf: 100, plusBalanceChf: 100, minusBalanceChf: 0, fxPnlChf: -3245 }),
      );

      expect(entry.fxPnlChf).toBe(-3245);
    });

    it('defaults historical entries logged before fxPnlChf existed to 0', () => {
      const entry = service['mapSummaryToEntry'](
        summaryWith({ totalBalanceChf: 100, plusBalanceChf: 100, minusBalanceChf: 0, fxPnlChf: null }),
      );

      expect(entry.fxPnlChf).toBe(0);
    });

    it('defaults null totalBalanceChf/plusBalanceChf/minusBalanceChf (as the repository now returns for missing/null source data, F13) to 0 in the response — same as the old mapLogToEntry ?? 0 defaults', () => {
      const entry = service['mapSummaryToEntry'](
        summaryWith({ totalBalanceChf: null, plusBalanceChf: null, minusBalanceChf: null, fxPnlChf: null }),
      );

      expect(entry.totalBalanceChf).toBe(0);
      expect(entry.plusBalanceChf).toBe(0);
      expect(entry.minusBalanceChf).toBe(0);
      expect(entry.fxPnlChf).toBe(0);
    });

    it('produces the same FinancialLogEntryDto the old mapLogToEntry would have for equivalent data', () => {
      // Underlying FinanceLog.message JSON that the old mapper would have parsed:
      // {
      //   balancesTotal: { totalBalanceChf: 1000, plusBalanceChf: 1500, minusBalanceChf: 500, fxPnlChf: -12.5 },
      //   balancesByFinancialType: {
      //     Crypto: { plusBalance: 1, plusBalanceChf: 800, minusBalance: 0, minusBalanceChf: 200 },
      //     Fiat: { plusBalance: 1, plusBalanceChf: 700, minusBalance: 0, minusBalanceChf: 300 },
      //   },
      //   assets: { "7": { priceChf: 65000.25 } },
      // }
      // Old mapLogToEntry(log, 7) expected output (reconstructed byte-for-byte from that path):
      const expectedFromOldMapper = {
        timestamp: new Date('2026-07-14T12:00:00Z'),
        totalBalanceChf: 1000,
        plusBalanceChf: 1500,
        minusBalanceChf: 500,
        fxPnlChf: -12.5,
        btcPriceChf: 65000.25,
        balancesByType: {
          Crypto: { plusBalanceChf: 800, minusBalanceChf: 200 },
          Fiat: { plusBalanceChf: 700, minusBalanceChf: 300 },
        },
      };

      const summary: FinancialLogSummary = {
        created: expectedFromOldMapper.timestamp,
        id: 42,
        totalBalanceChf: 1000,
        plusBalanceChf: 1500,
        minusBalanceChf: 500,
        fxPnlChf: -12.5,
        btcPriceChf: 65000.25,
        balancesByType: {
          Crypto: { plusBalanceChf: 800, minusBalanceChf: 200 },
          Fiat: { plusBalanceChf: 700, minusBalanceChf: 300 },
        },
      };

      expect(service['mapSummaryToEntry'](summary)).toEqual(expectedFromOldMapper);
    });

    it('produces the same FinancialLogEntryDto the old mapLogToEntry/extractBtcPrice pathway would have when btcAssetId is undefined (no BTC asset resolved)', () => {
      // Underlying FinanceLog.message JSON (assets present, but no BTC asset id was resolved this call):
      // {
      //   balancesTotal: { totalBalanceChf: 1000, plusBalanceChf: 1500, minusBalanceChf: 500, fxPnlChf: -12.5 },
      //   balancesByFinancialType: { Crypto: { plusBalanceChf: 800, minusBalanceChf: 200 } },
      //   assets: { "7": { priceChf: 65000.25 } },
      // }
      // Old extractBtcPrice(financeLog, undefined): `!btcAssetId` is true for undefined => returns 0,
      // regardless of `assets` content. Old mapLogToEntry expected output:
      const expectedFromOldMapper = {
        timestamp: new Date('2026-07-14T12:00:00Z'),
        totalBalanceChf: 1000,
        plusBalanceChf: 1500,
        minusBalanceChf: 500,
        fxPnlChf: -12.5,
        btcPriceChf: 0,
        balancesByType: { Crypto: { plusBalanceChf: 800, minusBalanceChf: 200 } },
      };

      // New path: getFinancialLogSummaries projects a SQL literal 0 when btcAssetId is undefined (no
      // assets path parameter bound), so the summary already carries btcPriceChf: 0.
      const summary: FinancialLogSummary = {
        created: expectedFromOldMapper.timestamp,
        id: 42,
        totalBalanceChf: 1000,
        plusBalanceChf: 1500,
        minusBalanceChf: 500,
        fxPnlChf: -12.5,
        btcPriceChf: 0,
        balancesByType: { Crypto: { plusBalanceChf: 800, minusBalanceChf: 200 } },
      };

      expect(service['mapSummaryToEntry'](summary)).toEqual(expectedFromOldMapper);
    });

    it('produces the same FinancialLogEntryDto the old mapLogToEntry/extractBtcPrice pathway would have when btcAssetId is 0 (falsy, same as undefined)', () => {
      // Same underlying FinanceLog.message JSON as above, but btcAssetId = 0 this time.
      // Old extractBtcPrice(financeLog, 0): `!btcAssetId` is true for 0 (falsy) => returns 0, exactly
      // like the undefined case above — this is the behaviour F1 restores (id=0 is unreachable in this
      // database today, but the falsy check keeps the two cases byte-identical, as before the projection
      // was moved into SQL).
      const expectedFromOldMapper = {
        timestamp: new Date('2026-07-14T12:00:00Z'),
        totalBalanceChf: 1000,
        plusBalanceChf: 1500,
        minusBalanceChf: 500,
        fxPnlChf: -12.5,
        btcPriceChf: 0,
        balancesByType: { Crypto: { plusBalanceChf: 800, minusBalanceChf: 200 } },
      };

      // New path: getFinancialLogSummaries(0, ...) also takes the SQL-literal-0 branch (F1 falsy check),
      // so the summary carries btcPriceChf: 0 here too — identical to the btcAssetId=undefined case.
      const summary: FinancialLogSummary = {
        created: expectedFromOldMapper.timestamp,
        id: 43,
        totalBalanceChf: 1000,
        plusBalanceChf: 1500,
        minusBalanceChf: 500,
        fxPnlChf: -12.5,
        btcPriceChf: 0,
        balancesByType: { Crypto: { plusBalanceChf: 800, minusBalanceChf: 200 } },
      };

      expect(service['mapSummaryToEntry'](summary)).toEqual(expectedFromOldMapper);
    });
  });

  describe('getFinancialLog', () => {
    it('resolves getBtcCoin before getFinancialLogSummaries (ordering required for SQL btcAssetId)', async () => {
      const btcAsset = { id: 7 } as Awaited<ReturnType<AssetService['getBtcCoin']>>;
      const summaries: FinancialLogSummary[] = [
        {
          created: new Date('2026-07-14T00:00:00Z'),
          id: 1,
          totalBalanceChf: 100,
          plusBalanceChf: 120,
          minusBalanceChf: 20,
          fxPnlChf: 1.5,
          btcPriceChf: 64000,
          balancesByType: { Crypto: { plusBalanceChf: 120, minusBalanceChf: 20 } },
        },
      ];

      const getBtcCoinSpy = jest.spyOn(assetService, 'getBtcCoin').mockResolvedValue(btcAsset);
      const getSummariesSpy = jest.spyOn(logService, 'getFinancialLogSummaries').mockResolvedValue(summaries);

      const from = new Date('2026-07-01T00:00:00Z');
      const result = await service.getFinancialLog(from, true);

      expect(getBtcCoinSpy).toHaveBeenCalled();
      expect(getSummariesSpy).toHaveBeenCalledWith(7, from, true, undefined, undefined, undefined, undefined);
      // Ordering matters: btcAssetId is a SQL projection parameter, so getBtcCoin must finish first.
      expect(getBtcCoinSpy.mock.invocationCallOrder[0]).toBeLessThan(getSummariesSpy.mock.invocationCallOrder[0]);

      expect(result.entries).toEqual([
        {
          timestamp: summaries[0].created,
          totalBalanceChf: 100,
          plusBalanceChf: 120,
          minusBalanceChf: 20,
          fxPnlChf: 1.5,
          btcPriceChf: 64000,
          balancesByType: { Crypto: { plusBalanceChf: 120, minusBalanceChf: 20 } },
        },
      ]);
      // Mutation guard: projected plus/minus and btc price must survive end-to-end.
      expect(result.entries[0].plusBalanceChf).not.toBe(result.entries[0].minusBalanceChf);
      expect(result.entries[0].btcPriceChf).toBe(64000);
    });

    it('passes undefined btcAssetId when getBtcCoin returns no asset', async () => {
      jest.spyOn(assetService, 'getBtcCoin').mockResolvedValue(undefined as never);
      const getSummariesSpy = jest.spyOn(logService, 'getFinancialLogSummaries').mockResolvedValue([]);

      await service.getFinancialLog();

      expect(getSummariesSpy).toHaveBeenCalledWith(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });

    it('forwards includeByType=false through to getFinancialLogSummaries and the response omits balancesByType entirely (not an empty object, not null)', async () => {
      const btcAsset = { id: 7 } as Awaited<ReturnType<AssetService['getBtcCoin']>>;
      const summaries: FinancialLogSummary[] = [
        {
          created: new Date('2026-07-14T00:00:00Z'),
          id: 1,
          totalBalanceChf: 100,
          plusBalanceChf: 120,
          minusBalanceChf: 20,
          fxPnlChf: 1.5,
          btcPriceChf: 64000,
          // no balancesByType key: the repository omits it entirely when includeByType is false
        },
      ];
      jest.spyOn(assetService, 'getBtcCoin').mockResolvedValue(btcAsset);
      const getSummariesSpy = jest.spyOn(logService, 'getFinancialLogSummaries').mockResolvedValue(summaries);

      const from = new Date('2026-07-01T00:00:00Z');
      const result = await service.getFinancialLog(from, true, false);

      expect(getSummariesSpy).toHaveBeenCalledWith(7, from, true, undefined, undefined, undefined, false);
      expect('balancesByType' in result.entries[0]).toBe(false);
      expect(JSON.parse(JSON.stringify(result.entries[0]))).not.toHaveProperty('balancesByType');
    });
  });
});
