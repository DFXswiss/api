import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { RefRewardService } from 'src/subdomains/core/referral/reward/services/ref-reward.service';
import { AssetLog, BalancesByFinancialType } from '../../log/dto/log.dto';
import { Log } from '../../log/log.entity';
import { FinancialLogSummary } from '../../log/log.repository';
import { LogService } from '../../log/log.service';
import { DashboardFinancialService } from '../dashboard-financial.service';
import { LatestBalanceResponseDto } from '../dto/financial-log.dto';
import { LatestBalanceStore } from '../latest-balance.store';

describe('DashboardFinancialService', () => {
  let service: DashboardFinancialService;
  let logService: LogService;
  let assetService: AssetService;
  let latestBalanceStore: LatestBalanceStore;

  beforeEach(async () => {
    logService = createMock<LogService>();
    assetService = createMock<AssetService>();
    latestBalanceStore = createMock<LatestBalanceStore>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardFinancialService,
        { provide: LogService, useValue: logService },
        { provide: AssetService, useValue: assetService },
        { provide: RefRewardService, useValue: createMock<RefRewardService>() },
        { provide: LatestBalanceStore, useValue: latestBalanceStore },
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

    it('forwards includeByType=false through to getFinancialLogSummaries and the response omits plusBalanceChf, minusBalanceChf, fxPnlChf and balancesByType entirely (chart-only contract, not 0, not null)', async () => {
      const btcAsset = { id: 7 } as Awaited<ReturnType<AssetService['getBtcCoin']>>;
      const summaries: FinancialLogSummary[] = [
        {
          created: new Date('2026-07-14T00:00:00Z'),
          id: 1,
          totalBalanceChf: 100,
          btcPriceChf: 64000,
          // plusBalanceChf/minusBalanceChf/fxPnlChf/balancesByType intentionally absent: the
          // repository's chart-only path never selects them when includeByType is false.
        },
      ];
      jest.spyOn(assetService, 'getBtcCoin').mockResolvedValue(btcAsset);
      const getSummariesSpy = jest.spyOn(logService, 'getFinancialLogSummaries').mockResolvedValue(summaries);

      const from = new Date('2026-07-01T00:00:00Z');
      const result = await service.getFinancialLog(from, true, false);

      expect(getSummariesSpy).toHaveBeenCalledWith(7, from, true, undefined, undefined, undefined, false);
      expect(result.entries[0]).toEqual({
        timestamp: summaries[0].created,
        totalBalanceChf: 100,
        btcPriceChf: 64000,
      });
      expect('plusBalanceChf' in result.entries[0]).toBe(false);
      expect('minusBalanceChf' in result.entries[0]).toBe(false);
      expect('fxPnlChf' in result.entries[0]).toBe(false);
      expect('balancesByType' in result.entries[0]).toBe(false);
    });
  });

  describe('getLatestBalance (write-through store read)', () => {
    it('returns undefined when the store is empty and never touches the database', async () => {
      jest.spyOn(latestBalanceStore, 'get').mockReturnValue(undefined);
      const getLatestFinancialLogSpy = jest.spyOn(logService, 'getLatestFinancialLog');
      const getAssetsByIdSpy = jest.spyOn(assetService, 'getAssetsById');

      const result = await service.getLatestBalance();

      expect(result).toBeUndefined();
      expect(getLatestFinancialLogSpy).toHaveBeenCalledTimes(0);
      expect(getAssetsByIdSpy).toHaveBeenCalledTimes(0);
    });

    it('returns exactly the value held in the store (pure store read)', async () => {
      const cached: LatestBalanceResponseDto = {
        timestamp: new Date('2026-07-14T12:00:00Z'),
        byType: [{ name: 'Crypto', plusBalanceChf: 100, minusBalanceChf: 0, netBalanceChf: 100 }],
        byBlockchain: [{ name: 'Ethereum', plusBalanceChf: 100, minusBalanceChf: 0, netBalanceChf: 100 }],
      };
      jest.spyOn(latestBalanceStore, 'get').mockReturnValue(cached);

      await expect(service.getLatestBalance()).resolves.toBe(cached);
    });
  });

  describe('setLatestBalance (aggregation write-through)', () => {
    it('aggregates byType / byBlockchain (Scrypt split, 5000 CHF Other thresholds) and writes the result into the store', () => {
      // Fixture designed so every aggregation branch is exercised once:
      //
      // byType:
      //   Crypto: plus 10000 / minus 2000 -> net 8000
      //   Fiat:   plus 3000  / minus 500  -> net 2500
      //   sorted by net desc => Crypto, Fiat
      //
      // Assets / blockchains:
      //   id=1 Ethereum ETH:   total 10 * priceChf 1000 = 10000 CHF  (large asset within Ethereum)
      //   id=2 Ethereum DUST:  total 1  * priceChf 100  = 100 CHF    (small asset within Ethereum -> assets.Other)
      //     Ethereum total = 10100 >= 5000 -> kept; assets: { ETH: 10000, Other: 100 }
      //   id=3 Bitcoin BTC_SMALL: total 1 * priceChf 2000 = 2000 CHF
      //     Bitcoin total = 2000 < 5000 -> whole chain folded into top-level Other; assets: { BTC_SMALL: 2000 }
      //     2000 < 5000 so filteredOtherAssets.Other = 2000
      //   id=4 Scrypt SCRYPT: liquidity 5 + custom 1 = spot 6 * 3000 = 18000 CHF -> Scrypt Spot
      //                       pending 2 * 3000 = 6000 CHF -> Scrypt Pending
      //
      // byBlockchain before sort: Ethereum 10100, Scrypt Spot 18000, Scrypt Pending 6000
      // after sort by net desc: Scrypt Spot, Ethereum, Scrypt Pending; Other 2000 appended last (not sorted)
      const timestamp = new Date('2026-07-14T12:00:00Z');
      const balancesByFinancialType: BalancesByFinancialType = {
        Crypto: { plusBalance: 1, plusBalanceChf: 10000, minusBalance: 0, minusBalanceChf: 2000 },
        Fiat: { plusBalance: 1, plusBalanceChf: 3000, minusBalance: 0, minusBalanceChf: 500 },
      };
      const assetLog: AssetLog = {
        '1': { priceChf: 1000, plusBalance: { total: 10 }, minusBalance: { total: 0 } },
        '2': { priceChf: 100, plusBalance: { total: 1 }, minusBalance: { total: 0 } },
        '3': { priceChf: 2000, plusBalance: { total: 1 }, minusBalance: { total: 0 } },
        '4': {
          priceChf: 3000,
          plusBalance: {
            total: 8,
            liquidity: { total: 5 },
            custom: { total: 1 },
            pending: { total: 2 },
          },
          minusBalance: { total: 0 },
        },
      };
      const assets = [
        { id: 1, name: 'ETH', blockchain: Blockchain.ETHEREUM },
        { id: 2, name: 'DUST', blockchain: Blockchain.ETHEREUM },
        { id: 3, name: 'BTC_SMALL', blockchain: Blockchain.BITCOIN },
        { id: 4, name: 'SCRYPT', blockchain: 'Scrypt' as Blockchain },
      ] as Asset[];

      const expected: LatestBalanceResponseDto = {
        timestamp,
        byType: [
          { name: 'Crypto', plusBalanceChf: 10000, minusBalanceChf: 2000, netBalanceChf: 8000 },
          { name: 'Fiat', plusBalanceChf: 3000, minusBalanceChf: 500, netBalanceChf: 2500 },
        ],
        byBlockchain: [
          {
            name: 'Scrypt Spot',
            plusBalanceChf: 18000,
            minusBalanceChf: 0,
            netBalanceChf: 18000,
            assets: { SCRYPT: 18000 },
          },
          {
            name: 'Ethereum',
            plusBalanceChf: 10100,
            minusBalanceChf: 0,
            netBalanceChf: 10100,
            assets: { ETH: 10000, Other: 100 },
          },
          {
            name: 'Scrypt Pending',
            plusBalanceChf: 6000,
            minusBalanceChf: 0,
            netBalanceChf: 6000,
            assets: { SCRYPT: 6000 },
          },
          {
            name: 'Other',
            plusBalanceChf: 2000,
            minusBalanceChf: 0,
            netBalanceChf: 2000,
            assets: { Other: 2000 },
          },
        ],
      };

      service.setLatestBalance(timestamp, assetLog, balancesByFinancialType, assets);

      expect(latestBalanceStore.set).toHaveBeenCalledWith(expected);
    });

    it('treats a priceless asset (priceChf: null) neutrally: neither its own blockchain group nor a shared one is skewed', () => {
      // asset.approxPriceChf is a nullable `double precision` column in production (144 of 430 rows
      // are NULL there; 136 of those have no financialType at all) -- the AssetLog[id].priceChf: number
      // type does not reflect that. This is a regression guard for the round-trip removed in this PR:
      // a priceless asset's contribution is `total * null`, which JS coerces to `total * 0 = 0` (NOT
      // NaN -- NaN only occurs for `undefined`, which is not the real-world case here). So it must
      // vanish cleanly whether it sits alone on a blockchain or next to a priced asset on the same one.
      //
      // Fall A -- GHOST alone on Polygon, no price:
      //   plusChf = 5 * null = 0 -> Math.round(0) = 0 -> the `rounded <= 0` clause skips the group
      //   entirely. Polygon must not show up anywhere in byBlockchain (not even folded into Other).
      //
      // Fall B -- GOOD (priced) and BAD (priceless) both on Ethereum:
      //   GOOD: 2 * 4000 = 8000 CHF
      //   BAD:  999 * null = 0 CHF
      //   Ethereum total = 8000 + 0 = 8000 CHF -> >= 5000 THRESHOLD -> kept as its own group, clearly
      //   above the threshold, exactly as if BAD did not exist.
      //   assets breakdown: GOOD (8000, >= 5000) stays its own key; BAD contributes 0, which is
      //   < 5000 so it is folded into the local `assetOther` sum -- but that sum stays 0, so no
      //   synthetic 'Other' key is added either. No NaN/null anywhere in plusBalanceChf/netBalanceChf.
      const timestamp = new Date('2026-07-14T12:00:00Z');
      const balancesByFinancialType: BalancesByFinancialType = {};
      const assetLog: AssetLog = {
        '101': {
          priceChf: null as unknown as number,
          plusBalance: { total: 5 },
          minusBalance: { total: 0 },
        },
        '102': { priceChf: 4000, plusBalance: { total: 2 }, minusBalance: { total: 0 } },
        '103': {
          priceChf: null as unknown as number,
          plusBalance: { total: 999 },
          minusBalance: { total: 0 },
        },
      };
      const assets = [
        { id: 101, name: 'GHOST', blockchain: Blockchain.POLYGON },
        { id: 102, name: 'GOOD', blockchain: Blockchain.ETHEREUM },
        { id: 103, name: 'BAD', blockchain: Blockchain.ETHEREUM },
      ] as Asset[];

      const expected: LatestBalanceResponseDto = {
        timestamp,
        byType: [],
        byBlockchain: [
          {
            name: 'Ethereum',
            plusBalanceChf: 8000,
            minusBalanceChf: 0,
            netBalanceChf: 8000,
            assets: { GOOD: 8000 },
          },
        ],
      };

      const errorSpy = jest.spyOn(service['logger'], 'error');

      service.setLatestBalance(timestamp, assetLog, balancesByFinancialType, assets);

      expect(latestBalanceStore.set).toHaveBeenCalledWith(expected);
      // priceChf: null is the known, harmless normal case (144 of 430 production assets), not a defect:
      // it must stay out of the log, otherwise the non-finite-price error line below is drowned out.
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('reports a NaN priceChf exactly once and leaves the poisoned aggregate uncorrected (no silent 0 normalisation)', () => {
      // Before the JSON round-trip was removed, JSON.stringify collapsed NaN to null on the way into
      // this aggregation; now it reaches the arithmetic directly and NaN-propagates through the whole
      // blockchain total. The fix is to say so loudly, NOT to invent a value -- booking a broken price
      // as 0 would silently understate the book. This test therefore asserts the UNTOUCHED arithmetic:
      //
      //   BROKEN (NaN): 5 * NaN = NaN   -> Ethereum plus = NaN (poisons the whole group)
      //   GOOD:         2 * 4000 = 8000 -> survives as its own asset key (8000 >= 5000 THRESHOLD)
      //
      //   Ethereum rounded = Math.round(NaN) = NaN: `rounded <= 0` is false and `rounded < THRESHOLD`
      //   is false (every comparison with NaN is false), so the group is kept with plusBalanceChf NaN.
      //   BROKEN's own NaN entry falls into the local assetOther sum, which stays NaN and therefore
      //   never passes `assetOther > 0` -- so no synthetic 'Other' key is added.
      //
      // A later "fix" that normalises the price to 0 or null would turn plusBalanceChf into 8000 and
      // break this test on purpose.
      const timestamp = new Date('2026-07-14T12:00:00Z');
      const balancesByFinancialType: BalancesByFinancialType = {};
      const assetLog: AssetLog = {
        '201': { priceChf: NaN, plusBalance: { total: 5 }, minusBalance: { total: 0 } },
        '202': { priceChf: 4000, plusBalance: { total: 2 }, minusBalance: { total: 0 } },
      };
      const assets = [
        { id: 201, name: 'BROKEN', blockchain: Blockchain.ETHEREUM },
        { id: 202, name: 'GOOD', blockchain: Blockchain.ETHEREUM },
      ] as Asset[];

      const expected: LatestBalanceResponseDto = {
        timestamp,
        byType: [],
        byBlockchain: [
          {
            name: 'Ethereum',
            plusBalanceChf: NaN,
            minusBalanceChf: 0,
            netBalanceChf: NaN,
            assets: { GOOD: 8000 },
          },
        ],
      };

      const errorSpy = jest.spyOn(service['logger'], 'error');

      service.setLatestBalance(timestamp, assetLog, balancesByFinancialType, assets);

      // one line per affected asset entry, emitted before the Scrypt/else split, carrying asset id,
      // name and the actual value so the broken asset can be found from the log alone
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('201'));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('BROKEN'));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('NaN'));

      expect(latestBalanceStore.set).toHaveBeenCalledWith(expected);
      // explicit: the value was reported, not repaired
      const written = (latestBalanceStore.set as jest.Mock).mock.calls[0][0] as LatestBalanceResponseDto;
      expect(Number.isNaN(written.byBlockchain[0].plusBalanceChf)).toBe(true);
      expect(Number.isNaN(written.byBlockchain[0].netBalanceChf)).toBe(true);
    });

    it('reports an Infinity priceChf exactly once and keeps the resulting Infinity totals uncorrected', () => {
      // Infinity survives Math.round and every threshold comparison (Infinity >= 5000), so unlike NaN it
      // stays visible as its own asset key -- still a corrupt number that must be reported, not replaced.
      const timestamp = new Date('2026-07-14T12:00:00Z');
      const balancesByFinancialType: BalancesByFinancialType = {};
      const assetLog: AssetLog = {
        '301': { priceChf: Infinity, plusBalance: { total: 5 }, minusBalance: { total: 0 } },
      };
      const assets = [{ id: 301, name: 'BROKEN_INF', blockchain: Blockchain.BITCOIN }] as Asset[];

      const expected: LatestBalanceResponseDto = {
        timestamp,
        byType: [],
        byBlockchain: [
          {
            name: 'Bitcoin',
            plusBalanceChf: Infinity,
            minusBalanceChf: 0,
            netBalanceChf: Infinity,
            assets: { BROKEN_INF: Infinity },
          },
        ],
      };

      const errorSpy = jest.spyOn(service['logger'], 'error');

      service.setLatestBalance(timestamp, assetLog, balancesByFinancialType, assets);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('301'));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Infinity'));

      expect(latestBalanceStore.set).toHaveBeenCalledWith(expected);
      const written = (latestBalanceStore.set as jest.Mock).mock.calls[0][0] as LatestBalanceResponseDto;
      expect(written.byBlockchain[0].plusBalanceChf).toBe(Infinity);
    });

    it('reports an undefined priceChf too (it produces NaN, so it must not share the null exemption)', () => {
      // Guard for the strict `!== null` comparison: a loose `!= null` would also cover undefined and
      // silently swallow this case, even though `total * undefined === NaN` corrupts the aggregate
      // exactly like NaN does (5 * undefined = NaN -> Polygon plus = NaN, asset breakdown empty because
      // neither the NaN asset value nor the NaN assetOther sum passes its comparison).
      const timestamp = new Date('2026-07-14T12:00:00Z');
      const balancesByFinancialType: BalancesByFinancialType = {};
      const assetLog: AssetLog = {
        '401': {
          priceChf: undefined as unknown as number,
          plusBalance: { total: 5 },
          minusBalance: { total: 0 },
        },
      };
      const assets = [{ id: 401, name: 'GHOST_UNDEF', blockchain: Blockchain.POLYGON }] as Asset[];

      const expected: LatestBalanceResponseDto = {
        timestamp,
        byType: [],
        byBlockchain: [
          {
            name: 'Polygon',
            plusBalanceChf: NaN,
            minusBalanceChf: 0,
            netBalanceChf: NaN,
            assets: {},
          },
        ],
      };

      const errorSpy = jest.spyOn(service['logger'], 'error');

      service.setLatestBalance(timestamp, assetLog, balancesByFinancialType, assets);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('undefined'));

      expect(latestBalanceStore.set).toHaveBeenCalledWith(expected);
    });
  });
});
