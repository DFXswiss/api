import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { RefRewardService } from 'src/subdomains/core/referral/reward/services/ref-reward.service';
import { createCustomLog } from '../../log/__mocks__/log.entity.mock';
import { LogService } from '../../log/log.service';
import { DashboardFinancialService } from '../dashboard-financial.service';

describe('DashboardFinancialService', () => {
  let service: DashboardFinancialService;

  let logService: LogService;
  let assetService: AssetService;
  let refRewardService: RefRewardService;

  beforeEach(async () => {
    logService = createMock<LogService>();
    assetService = createMock<AssetService>();
    refRewardService = createMock<RefRewardService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardFinancialService,
        { provide: LogService, useValue: logService },
        { provide: AssetService, useValue: assetService },
        { provide: RefRewardService, useValue: refRewardService },
      ],
    }).compile();

    service = module.get(DashboardFinancialService);
  });

  describe('getFinancialLog (chart fast path)', () => {
    it('uses denormalised aggregate columns without parsing the message JSON', async () => {
      const log = createCustomLog({
        id: 42,
        created: new Date('2026-05-19T12:00:00Z'),
        message: '{"this":"must not be parsed"}',
        totalBalanceChf: 1_000_000,
        plusBalanceChf: 1_200_000,
        minusBalanceChf: 200_000,
        btcPriceChf: 90_000,
        balancesByTypeJson: JSON.stringify({ EUR: { plusBalanceChf: 50, minusBalanceChf: 10 } }),
      });

      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([log]);
      jest.spyOn(assetService, 'getBtcCoin').mockResolvedValue({ id: 1 } as never);

      const result = await service.getFinancialLog(new Date(), false);

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toEqual({
        timestamp: log.created,
        totalBalanceChf: 1_000_000,
        plusBalanceChf: 1_200_000,
        minusBalanceChf: 200_000,
        btcPriceChf: 90_000,
        balancesByType: { EUR: { plusBalanceChf: 50, minusBalanceChf: 10 } },
      });
    });

    it('falls back to JSON.parse for legacy rows without denormalised columns', async () => {
      const message = JSON.stringify({
        balancesByFinancialType: { EUR: { plusBalanceChf: 100, minusBalanceChf: 20 } },
        balancesTotal: { plusBalanceChf: 100, minusBalanceChf: 20, totalBalanceChf: 80 },
        assets: { 1: { priceChf: 90_000 } },
      });

      const legacyLog = createCustomLog({
        id: 1,
        created: new Date('2024-01-01T00:00:00Z'),
        message,
        totalBalanceChf: null,
        plusBalanceChf: null,
        minusBalanceChf: null,
        btcPriceChf: null,
        balancesByTypeJson: null,
      });

      jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([legacyLog]);
      jest.spyOn(assetService, 'getBtcCoin').mockResolvedValue({ id: 1 } as never);

      const result = await service.getFinancialLog(new Date(), false);

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toMatchObject({
        totalBalanceChf: 80,
        plusBalanceChf: 100,
        minusBalanceChf: 20,
        btcPriceChf: 90_000,
        balancesByType: { EUR: { plusBalanceChf: 100, minusBalanceChf: 20 } },
      });
    });

    it('caches results within the TTL window', async () => {
      const log = createCustomLog({
        id: 1,
        created: new Date(),
        totalBalanceChf: 1,
        plusBalanceChf: 1,
        minusBalanceChf: 0,
        btcPriceChf: 0,
      });

      const spy = jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([log]);
      jest.spyOn(assetService, 'getBtcCoin').mockResolvedValue({ id: 1 } as never);

      const from = new Date();
      await service.getFinancialLog(from, false);
      await service.getFinancialLog(from, false);

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('uses different cache entries for different query parameters', async () => {
      const log = createCustomLog({
        id: 1,
        created: new Date(),
        totalBalanceChf: 1,
        plusBalanceChf: 1,
        minusBalanceChf: 0,
        btcPriceChf: 0,
      });

      const spy = jest.spyOn(logService, 'getFinancialLogs').mockResolvedValue([log]);
      jest.spyOn(assetService, 'getBtcCoin').mockResolvedValue({ id: 1 } as never);

      await service.getFinancialLog(new Date('2026-01-01'), false);
      await service.getFinancialLog(new Date('2026-01-02'), false);
      await service.getFinancialLog(new Date('2026-01-01'), true);

      expect(spy).toHaveBeenCalledTimes(3);
    });
  });
});
