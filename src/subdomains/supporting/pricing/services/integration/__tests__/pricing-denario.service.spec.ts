import { createMock } from '@golevelup/ts-jest';
import { ModuleRef } from '@nestjs/core';
import { ConfigService, Configuration } from 'src/config/config';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { HttpService } from 'src/shared/services/http.service';
import { PricingDenarioService } from '../pricing-denario.service';

describe('PricingDenarioService', () => {
  let service: PricingDenarioService;
  let http: jest.Mocked<HttpService>;
  let assetService: jest.Mocked<AssetService>;

  const PLACEHOLDER_API_KEY = 'test-denario-api-key-placeholder';
  const PLACEHOLDER_BASE_URL = 'https://denario-price.test.invalid';

  const goldUsdResponse = {
    priceAsk: '4511.00359',
    priceBid: '4259.41142',
    currency: 'USD',
    priceDate: new Date().toISOString(),
  };

  const silverChfResponse = {
    priceAsk: '56.75893',
    priceBid: '49.01426',
    currency: 'CHF',
    priceDate: new Date().toISOString(),
  };

  beforeAll(() => {
    process.env.DENARIO_PRICE_URL = PLACEHOLDER_BASE_URL;
    process.env.DENARIO_PRICE_API_KEY = PLACEHOLDER_API_KEY;
    new ConfigService(new Configuration());
  });

  beforeEach(() => {
    http = createMock<HttpService>();
    assetService = createMock<AssetService>();

    const moduleRef = {
      get: () => assetService,
    } as unknown as ModuleRef;

    service = new PricingDenarioService(http, moduleRef);
    service.onModuleInit();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('DGC → USD: convert(1) equals priceAsk (not bid, not mid)', async () => {
    http.get.mockResolvedValue(goldUsdResponse);

    const price = await service.getPrice('DGC', 'USD');

    expect(Math.abs(price.convert(1) - 4511.00359)).toBeLessThanOrEqual(0.0001);
    expect(price.isValid).toBe(true);

    // Explicit anti-bid: if the service used priceBid, convert(1) would match bid instead.
    expect(Math.abs(price.convert(1) - 4259.41142)).toBeGreaterThan(0.0001);
    // Mid would be ~4385.2 — also must not match.
    const mid = (4511.00359 + 4259.41142) / 2;
    expect(Math.abs(price.convert(1) - mid)).toBeGreaterThan(0.0001);
  });

  it('USD → DGC: inverted ask direction', async () => {
    http.get.mockResolvedValue(goldUsdResponse);

    const price = await service.getPrice('USD', 'DGC');

    // convert(1) = 1 / ask when from is the currency.
    expect(Math.abs(price.convert(1) - 1 / 4511.00359)).toBeLessThanOrEqual(1e-10);
    // Anti-mutation: inverted direction would yield the raw ask.
    expect(Math.abs(price.convert(1) - 4511.00359)).toBeGreaterThan(1);
  });

  it('DSC → CHF: convert(1) equals priceAsk', async () => {
    http.get.mockResolvedValue(silverChfResponse);

    const price = await service.getPrice('DSC', 'CHF');

    expect(Math.abs(price.convert(1) - 56.75893)).toBeLessThanOrEqual(0.0001);
    expect(Math.abs(price.convert(1) - 49.01426)).toBeGreaterThan(0.0001);
  });

  it('sets X-AUTH-TOKEN from config and calls the singular goldcoin path', async () => {
    http.get.mockResolvedValue(goldUsdResponse);

    await service.getPrice('DGC', 'USD');

    expect(http.get).toHaveBeenCalledTimes(1);
    const [url, config] = http.get.mock.calls[0];
    expect(url).toBe(`${PLACEHOLDER_BASE_URL}/api/goldcoin/latest/USD`);
    expect(config?.headers?.['X-AUTH-TOKEN']).toBe(PLACEHOLDER_API_KEY);
  });

  it('calls silvercoin path for DSC', async () => {
    http.get.mockResolvedValue(silverChfResponse);

    await service.getPrice('DSC', 'CHF');

    const [url] = http.get.mock.calls[0];
    expect(url).toBe(`${PLACEHOLDER_BASE_URL}/api/silvercoin/latest/CHF`);
  });

  it('does not call the API when the API key is missing', async () => {
    const savedKey = process.env.DENARIO_PRICE_API_KEY;
    try {
      delete process.env.DENARIO_PRICE_API_KEY;
      // Rebuild Configuration so Config.denario.apiKey is undefined.
      new ConfigService(new Configuration());

      assetService.getAssetByQuery.mockResolvedValue({
        approxPriceUsd: 4000,
        updated: new Date('2026-01-01T00:00:00Z'),
      } as any);

      const price = await service.getPrice('DGC', 'USD');

      expect(http.get).not.toHaveBeenCalled();
      expect(price.isValid).toBe(false);
      expect(Math.abs(price.convert(1) - 4000)).toBeLessThanOrEqual(0.0001);
    } finally {
      process.env.DENARIO_PRICE_API_KEY = savedKey;
      new ConfigService(new Configuration());
    }
  });

  it('falls back to last known asset price (isValid=false) when priceDate is stale', async () => {
    const staleDate = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour old
    http.get.mockResolvedValue({ ...goldUsdResponse, priceDate: staleDate });
    const timestamp = new Date('2026-06-01T00:00:00Z');
    assetService.getAssetByQuery.mockResolvedValue({
      approxPriceUsd: 4200,
      updated: timestamp,
    } as any);

    const price = await service.getPrice('DGC', 'USD');

    expect(price.isValid).toBe(false);
    expect(price.timestamp).toEqual(timestamp);
    expect(Math.abs(price.convert(1) - 4200)).toBeLessThanOrEqual(0.0001);
  });

  it('throws when priceDate is stale and no fallback asset price exists', async () => {
    const staleDate = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    http.get.mockResolvedValue({ ...goldUsdResponse, priceDate: staleDate });
    assetService.getAssetByQuery.mockResolvedValue({ approxPriceUsd: undefined, updated: new Date() } as any);

    await expect(service.getPrice('DGC', 'USD')).rejects.toThrow('No price available');
  });

  it('falls back on HTTP error', async () => {
    http.get.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 401'), { response: { status: 401 } }),
    );
    assetService.getAssetByQuery.mockResolvedValue({
      approxPriceUsd: 4100,
      updated: new Date('2026-05-01T00:00:00Z'),
    } as any);

    const price = await service.getPrice('DGC', 'USD');

    expect(price.isValid).toBe(false);
    expect(Math.abs(price.convert(1) - 4100)).toBeLessThanOrEqual(0.0001);
  });

  it('throws on HTTP error when no fallback exists', async () => {
    http.get.mockRejectedValue(new Error('network down'));
    assetService.getAssetByQuery.mockResolvedValue(null as any);

    await expect(service.getPrice('DGC', 'USD')).rejects.toThrow('No price available');
  });

  it.each([
    // token ↔ foreign asset / currency ↔ currency
    ['DGC', 'BTC'],
    ['USD', 'CHF'],
    ['BTC', 'DGC'],
    // token ↔ token must stay forbidden (catches a resolvePair branch that accepts both tokens via USD)
    ['DGC', 'DSC'],
    ['DSC', 'DGC'],
    // unknown token / unknown fiat
    ['XYZ', 'USD'],
    ['DGC', 'JPY'],
    ['JPY', 'DGC'],
    ['XYZ', 'DGC'],
  ] as const)('throws for disallowed pair %s → %s', async (from, to) => {
    await expect(service.getPrice(from, to)).rejects.toThrow('is not allowed');
    expect(http.get).not.toHaveBeenCalled();
  });

  it.each([
    ['0', 'not a sane price'],
    ['-1', 'not a sane price'],
    [null, 'missing or empty'],
    ['not-a-number', 'not a finite number'],
  ] as const)('throws for implausible priceAsk %j (no silent price)', async (priceAsk, messagePart) => {
    http.get.mockResolvedValue({ ...goldUsdResponse, priceAsk });

    await expect(service.getPrice('DGC', 'USD')).rejects.toThrow(messagePart);
    // Fallback must not mask a bad quote.
    expect(assetService.getAssetByQuery).not.toHaveBeenCalled();
  });
});
