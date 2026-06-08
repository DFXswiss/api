import { createMock } from '@golevelup/ts-jest';
import { ModuleRef } from '@nestjs/core';
import { ConfigService, Configuration } from 'src/config/config';
import { RealUnitBlockchainService } from 'src/integration/blockchain/realunit/realunit-blockchain.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PricingRealUnitService } from '../pricing-realunit.service';

describe('PricingRealUnitService', () => {
  let service: PricingRealUnitService;
  let realunitService: jest.Mocked<RealUnitBlockchainService>;
  let assetService: jest.Mocked<AssetService>;

  beforeAll(() => {
    new ConfigService(new Configuration());
  });

  beforeEach(() => {
    realunitService = createMock<RealUnitBlockchainService>();
    assetService = createMock<AssetService>();

    const moduleRef = {
      get: (token: unknown) => (token === RealUnitBlockchainService ? realunitService : assetService),
    } as unknown as ModuleRef;

    service = new PricingRealUnitService(moduleRef);
    service.onModuleInit();
  });

  it('returns the live price (valid) for REALU -> ZCHF', async () => {
    realunitService.getRealUnitPriceChf.mockResolvedValue(2);

    const price = await service.getPrice('REALU', 'ZCHF');

    expect(price.price).toBe(0.5);
    expect(price.isValid).toBe(true);
    expect(assetService.getAssetByQuery).not.toHaveBeenCalled();
  });

  it('falls back to the last persisted CHF price (invalid) when Aktionariat is down', async () => {
    realunitService.getRealUnitPriceChf.mockRejectedValue(new Error('Aktionariat down'));
    const timestamp = new Date('2026-06-01T00:00:00Z');
    assetService.getAssetByQuery.mockResolvedValue({ approxPriceChf: 4, approxPriceEur: 5, updated: timestamp } as any);

    const price = await service.getPrice('REALU', 'ZCHF');

    expect(price.price).toBe(0.25);
    expect(price.isValid).toBe(false);
    expect(price.timestamp).toEqual(timestamp);
  });

  it('uses the last persisted EUR price for EUR pairs in fallback', async () => {
    realunitService.getRealUnitPriceEur.mockRejectedValue(new Error('Aktionariat down'));
    assetService.getAssetByQuery.mockResolvedValue({
      approxPriceChf: 4,
      approxPriceEur: 5,
      updated: new Date(),
    } as any);

    const price = await service.getPrice('REALU', 'EUR');

    expect(price.price).toBe(0.2);
    expect(price.isValid).toBe(false);
  });

  it('throws when neither a live nor a persisted price is available', async () => {
    realunitService.getRealUnitPriceChf.mockRejectedValue(new Error('Aktionariat down'));
    assetService.getAssetByQuery.mockResolvedValue({ approxPriceChf: undefined, updated: new Date() } as any);

    await expect(service.getPrice('REALU', 'ZCHF')).rejects.toThrow('No price available');
  });
});
