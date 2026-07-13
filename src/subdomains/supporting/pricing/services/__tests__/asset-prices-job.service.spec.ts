import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { TestUtil } from 'src/shared/utils/test.util';
import { AssetPriceRepository } from '../../repositories/asset-price.repository';
import { AssetPricesJobService } from '../asset-prices-job.service';
import { PricingService } from '../pricing.service';

describe('AssetPricesJobService', () => {
  let service: AssetPricesJobService;

  let assetService: AssetService;
  let fiatService: FiatService;
  let pricingService: PricingService;
  let assetPriceRepo: AssetPriceRepository;

  beforeEach(async () => {
    assetService = createMock<AssetService>();
    fiatService = createMock<FiatService>();
    pricingService = createMock<PricingService>();
    assetPriceRepo = createMock<AssetPriceRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssetPricesJobService,
        { provide: AssetService, useValue: assetService },
        { provide: FiatService, useValue: fiatService },
        { provide: PricingService, useValue: pricingService },
        { provide: AssetPriceRepository, useValue: assetPriceRepo },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<AssetPricesJobService>(AssetPricesJobService);
  });

  afterEach(() => jest.restoreAllMocks());

  const priceOf = (value: number) => ({ convert: () => value }) as any;

  describe('#updatePrices', () => {
    it('stores sane prices', async () => {
      const asset = createCustomAsset({ id: 264, uniqueName: 'Arbitrum/TGT', type: AssetType.CUSTOM });
      jest.spyOn(assetService, 'getPricedAssets').mockResolvedValue([asset]);
      jest
        .spyOn(pricingService, 'getPrice')
        .mockResolvedValueOnce(priceOf(0.0075))
        .mockResolvedValueOnce(priceOf(0.0061))
        .mockResolvedValueOnce(priceOf(0.0064));

      await service.updatePrices();

      expect(assetService.updatePrices).toHaveBeenCalledWith([
        [264, { approxPriceUsd: 0.0075, approxPriceChf: 0.0061, approxPriceEur: 0.0064 }],
      ]);
    });

    it('skips the update and warns when a fetched price is degenerate', async () => {
      const warnSpy = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation(() => undefined);
      const asset = createCustomAsset({
        id: 264,
        uniqueName: 'Arbitrum/TGT',
        type: AssetType.CUSTOM,
        approxPriceChf: 0.0061,
      });
      jest.spyOn(assetService, 'getPricedAssets').mockResolvedValue([asset]);
      jest.spyOn(pricingService, 'getPrice').mockResolvedValue(priceOf(4.2421310463457016e-60));

      await service.updatePrices();

      expect(assetService.updatePrices).toHaveBeenCalledWith([]);
      expect(asset.approxPriceChf).toBe(0.0061);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Arbitrum/TGT'));
    });

    it('still updates the remaining assets when one price is degenerate', async () => {
      jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation(() => undefined);
      const degenerate = createCustomAsset({ id: 264, uniqueName: 'Arbitrum/TGT', type: AssetType.CUSTOM });
      const sane = createCustomAsset({ id: 265, uniqueName: 'Arbitrum/USDT', type: AssetType.CUSTOM });
      jest.spyOn(assetService, 'getPricedAssets').mockResolvedValue([degenerate, sane]);
      jest
        .spyOn(pricingService, 'getPrice')
        .mockResolvedValueOnce(priceOf(4.2421310463457016e-60))
        .mockResolvedValueOnce(priceOf(4.2421310463457016e-60))
        .mockResolvedValueOnce(priceOf(4.2421310463457016e-60))
        .mockResolvedValueOnce(priceOf(1.07))
        .mockResolvedValueOnce(priceOf(0.86))
        .mockResolvedValueOnce(priceOf(0.92));

      await service.updatePrices();

      expect(assetService.updatePrices).toHaveBeenCalledWith([
        [265, { approxPriceUsd: 1.07, approxPriceChf: 0.86, approxPriceEur: 0.92 }],
      ]);
    });
  });
});
