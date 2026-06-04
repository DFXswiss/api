import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import * as KycEnum from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { ReviewStatus } from 'src/subdomains/generic/kyc/enums/review-status.enum';
import { TestUtil } from 'src/shared/utils/test.util';
import { KycAdminService } from 'src/subdomains/generic/kyc/services/kyc-admin.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { TransactionRequestType } from '../../payment/entities/transaction-request.entity';
import { TransactionService } from '../../payment/services/transaction.service';
import {
  RealUnitGrowthStats,
  RealUnitKycFunnelStep,
  RealUnitRegistrationStats,
  RealUnitStatsDto,
  RealUnitStatsPeriod,
  RealUnitTradingStats,
} from '../dto/realunit-stats.dto';
import { RealUnitStatsService } from '../realunit-stats.service';
import { RealUnitService } from '../realunit.service';

describe('RealUnitStatsService', () => {
  let service: RealUnitStatsService;
  let realUnitService: jest.Mocked<RealUnitService>;
  let userDataService: jest.Mocked<UserDataService>;
  let userService: jest.Mocked<UserService>;
  let kycAdminService: jest.Mocked<KycAdminService>;
  let transactionService: jest.Mocked<TransactionService>;

  const realuAsset = createCustomAsset({
    id: 408,
    name: 'REALU',
    blockchain: Blockchain.ETHEREUM,
    type: AssetType.TOKEN,
  });

  beforeEach(async () => {
    realUnitService = createMock<RealUnitService>();
    userDataService = createMock<UserDataService>();
    userService = createMock<UserService>();
    kycAdminService = createMock<KycAdminService>();
    transactionService = createMock<TransactionService>();

    realUnitService.getRealuAsset.mockResolvedValue(realuAsset);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealUnitStatsService,
        { provide: RealUnitService, useValue: realUnitService },
        { provide: UserDataService, useValue: userDataService },
        { provide: UserService, useValue: userService },
        { provide: KycAdminService, useValue: kycAdminService },
        { provide: TransactionService, useValue: transactionService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get(RealUnitStatsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('doUpdate / getStats (populated)', () => {
    beforeEach(() => {
      // growth counts: total / 30d / 7d
      userDataService.getNewUserDataCount
        .mockResolvedValueOnce(1000)
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(20);
      userService.getNewUserCount.mockResolvedValueOnce(1500).mockResolvedValueOnce(150).mockResolvedValueOnce(30);

      // KYC step counts: total / 30d / 7d
      kycAdminService.getKycStepCounts
        .mockResolvedValueOnce([
          { name: KycStepName.CONTACT_DATA, status: ReviewStatus.COMPLETED, count: 80 },
          { name: KycStepName.CONTACT_DATA, status: ReviewStatus.IN_PROGRESS, count: 20 },
          { name: KycStepName.IDENT, status: ReviewStatus.COMPLETED, count: 40 },
          { name: KycStepName.IDENT, status: ReviewStatus.FAILED, count: 10 },
          { name: KycStepName.REALUNIT_REGISTRATION, status: ReviewStatus.IN_PROGRESS, count: 5 },
          { name: KycStepName.REALUNIT_REGISTRATION, status: ReviewStatus.INTERNAL_REVIEW, count: 3 },
          { name: KycStepName.REALUNIT_REGISTRATION, status: ReviewStatus.COMPLETED, count: 12 },
        ])
        .mockResolvedValueOnce([
          { name: KycStepName.CONTACT_DATA, status: ReviewStatus.COMPLETED, count: 8 },
          { name: KycStepName.REALUNIT_REGISTRATION, status: ReviewStatus.COMPLETED, count: 2 },
        ])
        .mockResolvedValueOnce([{ name: KycStepName.CONTACT_DATA, status: ReviewStatus.COMPLETED, count: 1 }]);

      // Trading: total / 30d / 7d
      transactionService.getAssetTradingStats
        .mockResolvedValueOnce([
          { type: TransactionRequestType.BUY, volume: 12345.678, count: 50 },
          { type: TransactionRequestType.SELL, volume: 6789.123, count: 20 },
        ])
        .mockResolvedValueOnce([
          { type: TransactionRequestType.BUY, volume: 1234.5, count: 5 },
          { type: TransactionRequestType.SELL, volume: 678.9, count: 2 },
        ])
        .mockResolvedValueOnce([{ type: TransactionRequestType.BUY, volume: 100, count: 1 }]);
    });

    it('computes and caches the full stats DTO', async () => {
      await service.doUpdate();
      const stats = service.getStats();

      expect(stats.updated).toBeInstanceOf(Date);

      // growth
      expect(stats.growth.accounts).toEqual({ total: 1000, last30Days: 100, last7Days: 20 });
      expect(stats.growth.wallets).toEqual({ total: 1500, last30Days: 150, last7Days: 30 });

      // kyc funnel: one entry per REALUNIT_BUY required step (6 steps), registration step excluded
      expect(stats.kycFunnel).toHaveLength(6);
      const contactStep = stats.kycFunnel.find((s) => s.step === KycStepName.CONTACT_DATA);
      expect(contactStep?.reached).toEqual({ total: 100, last30Days: 8, last7Days: 1 });
      expect(contactStep?.completed).toEqual({ total: 80, last30Days: 8, last7Days: 1 });

      const identStep = stats.kycFunnel.find((s) => s.step === KycStepName.IDENT);
      expect(identStep?.reached).toEqual({ total: 50, last30Days: 0, last7Days: 0 });
      expect(identStep?.completed).toEqual({ total: 40, last30Days: 0, last7Days: 0 });

      // registration is the REALUNIT_REGISTRATION step, never part of the funnel array
      expect(stats.kycFunnel.some((s) => s.step === KycStepName.REALUNIT_REGISTRATION)).toBe(false);
      expect(stats.registration.started).toEqual({ total: 20, last30Days: 2, last7Days: 0 });
      expect(stats.registration.inReview).toEqual({ total: 8, last30Days: 0, last7Days: 0 });
      expect(stats.registration.completed).toEqual({ total: 12, last30Days: 2, last7Days: 0 });

      // trading (volume rounded to 2 decimals)
      expect(stats.trading.buyVolumeChf).toEqual({ total: 12345.68, last30Days: 1234.5, last7Days: 100 });
      expect(stats.trading.buyCount).toEqual({ total: 50, last30Days: 5, last7Days: 1 });
      expect(stats.trading.sellVolumeChf).toEqual({ total: 6789.12, last30Days: 678.9, last7Days: 0 });
      expect(stats.trading.sellCount).toEqual({ total: 20, last30Days: 2, last7Days: 0 });
    });
  });

  describe('doUpdate / getStats (empty / zero)', () => {
    beforeEach(() => {
      userDataService.getNewUserDataCount.mockResolvedValue(0);
      userService.getNewUserCount.mockResolvedValue(0);
      kycAdminService.getKycStepCounts.mockResolvedValue([]);
      transactionService.getAssetTradingStats.mockResolvedValue([]);
    });

    it('falls back to zero for all KPIs when no data exists', async () => {
      await service.doUpdate();
      const stats = service.getStats();

      expect(stats.growth.accounts).toEqual({ total: 0, last30Days: 0, last7Days: 0 });
      expect(stats.growth.wallets).toEqual({ total: 0, last30Days: 0, last7Days: 0 });
      expect(stats.kycFunnel).toHaveLength(6);
      stats.kycFunnel.forEach((step) => {
        expect(step.reached).toEqual({ total: 0, last30Days: 0, last7Days: 0 });
        expect(step.completed).toEqual({ total: 0, last30Days: 0, last7Days: 0 });
      });
      expect(stats.registration.started).toEqual({ total: 0, last30Days: 0, last7Days: 0 });
      expect(stats.registration.inReview).toEqual({ total: 0, last30Days: 0, last7Days: 0 });
      expect(stats.registration.completed).toEqual({ total: 0, last30Days: 0, last7Days: 0 });
      expect(stats.trading.buyVolumeChf).toEqual({ total: 0, last30Days: 0, last7Days: 0 });
      expect(stats.trading.buyCount).toEqual({ total: 0, last30Days: 0, last7Days: 0 });
      expect(stats.trading.sellVolumeChf).toEqual({ total: 0, last30Days: 0, last7Days: 0 });
      expect(stats.trading.sellCount).toEqual({ total: 0, last30Days: 0, last7Days: 0 });
    });

    it('produces an empty funnel when no required steps are defined for the context', async () => {
      const spy = jest.spyOn(KycEnum, 'contextRequiredSteps').mockReturnValue(undefined);

      await service.doUpdate();
      const stats = service.getStats();

      expect(stats.kycFunnel).toEqual([]);
      spy.mockRestore();
    });
  });

  describe('onModuleInit', () => {
    it('triggers a cache update', () => {
      const spy = jest.spyOn(service, 'doUpdate').mockResolvedValue();

      service.onModuleInit();

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('RealUnitStatsDto', () => {
    it('instantiates all DTO classes with the contract shape', () => {
      const period = Object.assign(new RealUnitStatsPeriod(), { total: 1, last30Days: 2, last7Days: 3 });
      const growth = Object.assign(new RealUnitGrowthStats(), { accounts: period, wallets: period });
      const funnelStep = Object.assign(new RealUnitKycFunnelStep(), {
        step: KycStepName.CONTACT_DATA,
        reached: period,
        completed: period,
      });
      const registration = Object.assign(new RealUnitRegistrationStats(), {
        started: period,
        inReview: period,
        completed: period,
      });
      const trading = Object.assign(new RealUnitTradingStats(), {
        buyVolumeChf: period,
        buyCount: period,
        sellVolumeChf: period,
        sellCount: period,
      });
      const dto = Object.assign(new RealUnitStatsDto(), {
        updated: new Date(),
        growth,
        kycFunnel: [funnelStep],
        registration,
        trading,
      });

      expect(dto.growth.accounts.total).toBe(1);
      expect(dto.kycFunnel[0].step).toBe(KycStepName.CONTACT_DATA);
      expect(dto.registration.completed.last7Days).toBe(3);
      expect(dto.trading.sellCount.last30Days).toBe(2);
    });
  });
});
