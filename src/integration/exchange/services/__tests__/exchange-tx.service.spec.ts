import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { Not } from 'typeorm';
import { createCustomExchangeTx } from '../../dto/__mocks__/exchange-tx.entity.mock';
import { ExchangeTxType } from '../../entities/exchange-tx.entity';
import { ExchangeName } from '../../enums/exchange.enum';
import { ExchangeTxRepository } from '../../repositories/exchange-tx.repository';
import { ExchangeRegistryService } from '../exchange-registry.service';
import { ExchangeTxService } from '../exchange-tx.service';

describe('ExchangeTxService', () => {
  let service: ExchangeTxService;

  let exchangeTxRepo: ExchangeTxRepository;
  let registryService: ExchangeRegistryService;
  let assetService: AssetService;
  let pricingService: PricingService;
  let fiatService: FiatService;

  beforeEach(async () => {
    exchangeTxRepo = createMock<ExchangeTxRepository>();
    registryService = createMock<ExchangeRegistryService>();
    assetService = createMock<AssetService>();
    pricingService = createMock<PricingService>();
    fiatService = createMock<FiatService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        ExchangeTxService,
        { provide: ExchangeTxRepository, useValue: exchangeTxRepo },
        { provide: ExchangeRegistryService, useValue: registryService },
        { provide: AssetService, useValue: assetService },
        { provide: PricingService, useValue: pricingService },
        { provide: FiatService, useValue: fiatService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<ExchangeTxService>(ExchangeTxService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('cleanupStalePendingDeposits', () => {
    it('should not include Scrypt deposits in the stale find query', async () => {
      const findSpy = jest.spyOn(exchangeTxRepo, 'find').mockResolvedValue([]);

      await service.cleanupStalePendingDeposits();

      expect(findSpy).toHaveBeenCalledTimes(1);
      const [findArgs] = findSpy.mock.calls[0];
      expect(findArgs?.where).toMatchObject({
        type: ExchangeTxType.DEPOSIT,
        status: 'pending',
        exchange: Not(ExchangeName.SCRYPT),
      });
    });

    it('should set stale pending non-Scrypt deposits to failed', async () => {
      const staleDeposits = [
        createCustomExchangeTx({ id: 101, exchange: ExchangeName.KRAKEN, type: ExchangeTxType.DEPOSIT }),
        createCustomExchangeTx({ id: 102, exchange: ExchangeName.BINANCE, type: ExchangeTxType.DEPOSIT }),
      ];

      jest.spyOn(exchangeTxRepo, 'find').mockResolvedValue(staleDeposits);
      const updateSpy = jest.spyOn(exchangeTxRepo, 'update').mockResolvedValue(undefined);

      await service.cleanupStalePendingDeposits();

      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith([101, 102], { status: 'failed' });
    });

    it('should early-return when no stale deposits', async () => {
      jest.spyOn(exchangeTxRepo, 'find').mockResolvedValue([]);
      const updateSpy = jest.spyOn(exchangeTxRepo, 'update');

      await service.cleanupStalePendingDeposits();

      expect(updateSpy).not.toHaveBeenCalled();
    });
  });
});
