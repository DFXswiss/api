import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { createCustomExchangeTx } from '../../dto/__mocks__/exchange-tx.entity.mock';
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
      ],
    }).compile();

    service = module.get<ExchangeTxService>(ExchangeTxService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // --- cleanupStalePendingDeposits --- //

  it('should set stale pending Scrypt deposits to ok', async () => {
    const stale = [
      createCustomExchangeTx({ id: 138339, exchange: ExchangeName.SCRYPT }),
      createCustomExchangeTx({ id: 138379, exchange: ExchangeName.SCRYPT }),
    ];
    jest.spyOn(exchangeTxRepo, 'find').mockResolvedValue(stale);
    const update = jest.spyOn(exchangeTxRepo, 'update').mockResolvedValue(undefined);

    await service.cleanupStalePendingDeposits();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith([138339, 138379], { status: 'ok' });
  });

  it('should set stale pending non-Scrypt deposits to failed', async () => {
    const stale = [
      createCustomExchangeTx({ id: 1, exchange: ExchangeName.KRAKEN }),
      createCustomExchangeTx({ id: 2, exchange: ExchangeName.BINANCE }),
    ];
    jest.spyOn(exchangeTxRepo, 'find').mockResolvedValue(stale);
    const update = jest.spyOn(exchangeTxRepo, 'update').mockResolvedValue(undefined);

    await service.cleanupStalePendingDeposits();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith([1, 2], { status: 'failed' });
  });

  it('should split mixed batches correctly between ok and failed', async () => {
    const stale = [
      createCustomExchangeTx({ id: 10, exchange: ExchangeName.SCRYPT }),
      createCustomExchangeTx({ id: 20, exchange: ExchangeName.KRAKEN }),
      createCustomExchangeTx({ id: 30, exchange: ExchangeName.SCRYPT }),
      createCustomExchangeTx({ id: 40, exchange: ExchangeName.MEXC }),
    ];
    jest.spyOn(exchangeTxRepo, 'find').mockResolvedValue(stale);
    const update = jest.spyOn(exchangeTxRepo, 'update').mockResolvedValue(undefined);

    await service.cleanupStalePendingDeposits();

    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith([10, 30], { status: 'ok' });
    expect(update).toHaveBeenCalledWith([20, 40], { status: 'failed' });
  });
});
