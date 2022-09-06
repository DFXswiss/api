import { mock } from 'jest-mock-extended';
import { MailService } from 'src/shared/services/mail.service';
import { Price } from '../../exchange/dto/price.dto';
import { createCustomPrice } from '../../exchange/dto/__mocks__/price.dto.mock';
import { BinanceService } from '../../exchange/services/binance.service';
import { BitpandaService } from '../../exchange/services/bitpanda.service';
import { BitstampService } from '../../exchange/services/bitstamp.service';
import { FixerService } from '../../exchange/services/fixer.service';
import { KrakenService } from '../../exchange/services/kraken.service';
import { PricingService } from '../services/pricing.service';

describe('Pricing Module Integration Tests', () => {
  let mailService: MailService;
  let krakenService: KrakenService;
  let binanceService: BinanceService;
  let bitstampService: BitstampService;
  let bitpandaService: BitpandaService;
  let fixerService: FixerService;

  let krakenServiceGetPriceSpy: jest.SpyInstance;
  let binanceServiceGetPriceSpy: jest.SpyInstance;
  let bitstampServiceGetPriceSpy: jest.SpyInstance;
  let bitpandaServiceGetPriceSpy: jest.SpyInstance;
  let fixerServiceGetPriceSpy: jest.SpyInstance;

  let service: PricingService;

  beforeEach(() => {
    mailService = mock<MailService>();
    krakenService = mock<KrakenService>({ name: 'Kraken' });
    binanceService = mock<BinanceService>({ name: 'Binance' });
    bitstampService = mock<BitstampService>({ name: 'Bitstamp' });
    bitpandaService = mock<BitpandaService>({ name: 'Bitpanda' });
    fixerService = mock<FixerService>({ name: 'Fixer' });

    service = new PricingService(
      mailService,
      krakenService,
      binanceService,
      bitstampService,
      bitpandaService,
      fixerService,
    );

    krakenServiceGetPriceSpy = jest.spyOn(krakenService, 'getPrice');
    binanceServiceGetPriceSpy = jest.spyOn(binanceService, 'getPrice');
    bitstampServiceGetPriceSpy = jest.spyOn(bitstampService, 'getPrice');
    bitpandaServiceGetPriceSpy = jest.spyOn(bitpandaService, 'getPrice');
    fixerServiceGetPriceSpy = jest.spyOn(fixerService, 'getPrice');
  });

  afterEach(() => {
    krakenServiceGetPriceSpy.mockClear();
    binanceServiceGetPriceSpy.mockClear();
    bitstampServiceGetPriceSpy.mockClear();
    bitpandaServiceGetPriceSpy.mockClear();
    fixerServiceGetPriceSpy.mockClear();
  });

  it('calculates price path for MATCHING_ASSETS', async () => {
    const request = { from: 'BTC', to: 'BTC' };
    const result = await service.getPrice(request);

    expect(result.price).toBeInstanceOf(Price);
    expect(result.price.source).toBe('BTC');
    expect(result.price.target).toBe('BTC');
    expect(result.price.price).toBe(1);

    expect(Array.isArray(result.path)).toBe(true);
    expect(result.path.length).toBe(1);

    expect(result.path[0].provider).toBe('FixedPrice');

    expect(result.path[0].price).toBeInstanceOf(Price);
    expect(result.path[0].price.source).toBe('BTC');
    expect(result.path[0].price.target).toBe('BTC');
    expect(result.path[0].price.price).toBe(1);

    expect(result.path[0].timestamp).toBeInstanceOf(Date);
  });

  it('calculates price path for FIAT_TO_BTC', async () => {
    krakenServiceGetPriceSpy = jest
      .spyOn(krakenService, 'getPrice')
      .mockImplementationOnce(async () => createCustomPrice({ source: 'USD', target: 'BTC', price: 0.00005 }));

    binanceServiceGetPriceSpy = jest
      .spyOn(binanceService, 'getPrice')
      .mockImplementationOnce(async () => createCustomPrice({ source: 'USD', target: 'BTC', price: 0.00005 }));

    const request = { from: 'USD', to: 'BTC' };
    const result = await service.getPrice(request);

    expect(result.price).toBeInstanceOf(Price);
    expect(result.price.source).toBe('USD');
    expect(result.price.target).toBe('BTC');
    expect(result.price.price).toBe(0.00005);

    expect(Array.isArray(result.path)).toBe(true);
    expect(result.path.length).toBe(1);

    expect(result.path[0].provider).toBe('Kraken');

    expect(result.path[0].price).toBeInstanceOf(Price);
    expect(result.path[0].price.source).toBe('USD');
    expect(result.path[0].price.target).toBe('BTC');
    expect(result.path[0].price.price).toBe(0.00005);

    expect(result.path[0].timestamp).toBeInstanceOf(Date);
  });

  it('calculates price path for ALTCOIN_TO_BTC', async () => {
    binanceServiceGetPriceSpy = jest
      .spyOn(binanceService, 'getPrice')
      .mockImplementationOnce(async () => createCustomPrice({ source: 'BNB', target: 'BTC', price: 0.014 }));

    krakenServiceGetPriceSpy = jest
      .spyOn(krakenService, 'getPrice')
      .mockImplementationOnce(async () => createCustomPrice({ source: 'BNB', target: 'BTC', price: 0.014 }));

    const request = { from: 'BNB', to: 'BTC' };
    const result = await service.getPrice(request);

    expect(result.price).toBeInstanceOf(Price);
    expect(result.price.source).toBe('BNB');
    expect(result.price.target).toBe('BTC');
    expect(result.price.price).toBe(0.014);

    expect(Array.isArray(result.path)).toBe(true);
    expect(result.path.length).toBe(1);

    expect(result.path[0].provider).toBe('Binance');

    expect(result.path[0].price).toBeInstanceOf(Price);
    expect(result.path[0].price.source).toBe('BNB');
    expect(result.path[0].price.target).toBe('BTC');
    expect(result.path[0].price.price).toBe(0.014);

    expect(result.path[0].timestamp).toBeInstanceOf(Date);
  });

  it.skip('calculates price path for FIAT_TO_ALTCOIN', async () => {
    binanceServiceGetPriceSpy = jest
      .spyOn(binanceService, 'getPrice')
      .mockImplementationOnce(async (source: string, target: string) =>
        createCustomPrice({ source, target, price: 0.000058 }),
      )
      .mockImplementationOnce(async (source: string, target: string) =>
        createCustomPrice({ source, target, price: 0.014 }),
      );

    krakenServiceGetPriceSpy = jest
      .spyOn(binanceService, 'getPrice')
      .mockImplementationOnce(async (source: string, target: string) =>
        createCustomPrice({ source, target, price: 0.000058 }),
      )
      .mockImplementationOnce(async (source: string, target: string) =>
        createCustomPrice({ source, target, price: 0.014 }),
      );

    const request = { from: 'GBP', to: 'BNB' };
    const result = await service.getPrice(request);

    expect(result.price).toBeInstanceOf(Price);
    expect(result.price.source).toBe('BNB');
    expect(result.price.target).toBe('BTC');
    expect(result.price.price).toBe(0.014);

    expect(Array.isArray(result.path)).toBe(true);
    expect(result.path.length).toBe(1);

    expect(result.path[0].provider).toBe('Binance');

    expect(result.path[0].price).toBeInstanceOf(Price);
    expect(result.path[0].price.source).toBe('BNB');
    expect(result.path[0].price.target).toBe('BTC');
    expect(result.path[0].price.price).toBe(0.014);

    expect(result.path[0].timestamp).toBeInstanceOf(Date);
  });

  it('calculates price path for ALTCOIN_TO_ALTCOIN', () => {
    // TODO
  });

  it('calculates price path for BTC_TO_ALTCOIN', () => {
    // TODO
  });

  it('calculates price path for MATCHING_FIAT_TO_USD_STABLE_COIN', () => {
    // TODO
  });

  it('calculates price path for NON_MATCHING_FIAT_TO_USD_STABLE_COIN', () => {
    // TODO
  });

  describe('General Failure Scenarios', () => {
    it('', () => {
      // TODO
    });
  });
});
