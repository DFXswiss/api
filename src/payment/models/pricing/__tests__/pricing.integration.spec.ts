import { mock } from 'jest-mock-extended';
import { NotificationService } from 'src/notification/services/notification.service';
import { Price } from '../../exchange/dto/price.dto';
import { createCustomPrice } from '../../exchange/dto/__mocks__/price.dto.mock';
import { BinanceService } from '../../exchange/services/binance.service';
import { BitpandaService } from '../../exchange/services/bitpanda.service';
import { BitstampService } from '../../exchange/services/bitstamp.service';
import { CurrencyService } from '../../exchange/services/currency.service';
import { FixerService } from '../../exchange/services/fixer.service';
import { KrakenService } from '../../exchange/services/kraken.service';
import { PricingService } from '../services/pricing.service';

describe('Pricing Module Integration Tests', () => {
  let notificationService: NotificationService;
  let krakenService: KrakenService;
  let binanceService: BinanceService;
  let bitstampService: BitstampService;
  let bitpandaService: BitpandaService;
  let currencyService: CurrencyService;
  let fixerService: FixerService;

  let krakenServiceGetPriceSpy: jest.SpyInstance;
  let binanceServiceGetPriceSpy: jest.SpyInstance;
  let bitstampServiceGetPriceSpy: jest.SpyInstance;
  let bitpandaServiceGetPriceSpy: jest.SpyInstance;
  let currencyServiceGetPriceSpy: jest.SpyInstance;
  let fixerServiceGetPriceSpy: jest.SpyInstance;

  let service: PricingService;

  beforeEach(() => {
    notificationService = mock<NotificationService>();
    krakenService = mock<KrakenService>({ name: 'Kraken' });
    binanceService = mock<BinanceService>({ name: 'Binance' });
    bitstampService = mock<BitstampService>({ name: 'Bitstamp' });
    bitpandaService = mock<BitpandaService>({ name: 'Bitpanda' });
    currencyService = mock<CurrencyService>({ name: 'CurrencyService' });
    fixerService = mock<FixerService>({ name: 'FixerService' });

    service = new PricingService(
      notificationService,
      krakenService,
      binanceService,
      bitstampService,
      bitpandaService,
      currencyService,
      fixerService,
    );

    krakenServiceGetPriceSpy = jest.spyOn(krakenService, 'getPrice');
    binanceServiceGetPriceSpy = jest.spyOn(binanceService, 'getPrice');
    bitstampServiceGetPriceSpy = jest.spyOn(bitstampService, 'getPrice');
    bitpandaServiceGetPriceSpy = jest.spyOn(bitpandaService, 'getPrice');
    currencyServiceGetPriceSpy = jest.spyOn(currencyService, 'getPrice');
    fixerServiceGetPriceSpy = jest.spyOn(fixerService, 'getPrice');
  });

  afterEach(() => {
    krakenServiceGetPriceSpy.mockClear();
    binanceServiceGetPriceSpy.mockClear();
    bitstampServiceGetPriceSpy.mockClear();
    bitpandaServiceGetPriceSpy.mockClear();
    currencyServiceGetPriceSpy.mockClear();
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
      .mockImplementationOnce(async (source, target) => createCustomPrice({ source, target, price: 0.00005 }));

    binanceServiceGetPriceSpy = jest
      .spyOn(binanceService, 'getPrice')
      .mockImplementationOnce(async (source, target) => createCustomPrice({ source, target, price: 0.00005 }));

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
      .mockImplementationOnce(async (source, target) => createCustomPrice({ source, target, price: 0.014 }));

    krakenServiceGetPriceSpy = jest
      .spyOn(krakenService, 'getPrice')
      .mockImplementationOnce(async (source, target) => createCustomPrice({ source, target, price: 0.014 }));

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

  it('calculates price path for FIAT_TO_ALTCOIN', async () => {
    binanceServiceGetPriceSpy = jest
      .spyOn(binanceService, 'getPrice')
      .mockImplementationOnce(async (source: string, target: string) =>
        createCustomPrice({ source, target, price: 0.000058 }),
      )
      .mockImplementationOnce(async (source: string, target: string) =>
        createCustomPrice({ source, target, price: 71.3 }),
      );

    krakenServiceGetPriceSpy = jest
      .spyOn(krakenService, 'getPrice')
      .mockImplementationOnce(async (source: string, target: string) =>
        createCustomPrice({ source, target, price: 0.000058 }),
      )
      .mockImplementationOnce(async (source: string, target: string) =>
        createCustomPrice({ source, target, price: 71.3 }),
      );

    const request = { from: 'GBP', to: 'BNB' };
    const result = await service.getPrice(request);

    expect(result.price).toBeInstanceOf(Price);
    expect(result.price.source).toBe('GBP');
    expect(result.price.target).toBe('BNB');
    expect(result.price.price).toBe(0.0041354);

    expect(Array.isArray(result.path)).toBe(true);
    expect(result.path.length).toBe(2);

    expect(result.path[0].provider).toBe('Kraken');

    expect(result.path[0].price).toBeInstanceOf(Price);
    expect(result.path[0].price.source).toBe('GBP');
    expect(result.path[0].price.target).toBe('BTC');
    expect(result.path[0].price.price).toBe(0.000058);

    expect(result.path[0].timestamp).toBeInstanceOf(Date);

    expect(result.path[1].provider).toBe('Binance');

    expect(result.path[1].price).toBeInstanceOf(Price);
    expect(result.path[1].price.source).toBe('BTC');
    expect(result.path[1].price.target).toBe('BNB');
    expect(result.path[1].price.price).toBe(71.3);

    expect(result.path[1].timestamp).toBeInstanceOf(Date);
  });

  it('calculates price path for ALTCOIN_TO_ALTCOIN', async () => {
    binanceServiceGetPriceSpy = jest
      .spyOn(binanceService, 'getPrice')
      .mockImplementationOnce(async (source: string, target: string) =>
        createCustomPrice({ source, target, price: 0.081 }),
      )
      .mockImplementationOnce(async (source: string, target: string) =>
        createCustomPrice({ source, target, price: 71.3 }),
      );

    krakenServiceGetPriceSpy = jest
      .spyOn(krakenService, 'getPrice')
      .mockImplementationOnce(async (source: string, target: string) =>
        createCustomPrice({ source, target, price: 0.081 }),
      )
      .mockImplementationOnce(async (source: string, target: string) =>
        createCustomPrice({ source, target, price: 71.3 }),
      );

    const request = { from: 'ETH', to: 'BNB' };
    const result = await service.getPrice(request);

    expect(result.price).toBeInstanceOf(Price);
    expect(result.price.source).toBe('ETH');
    expect(result.price.target).toBe('BNB');
    expect(result.price.price).toBe(5.7753);

    expect(Array.isArray(result.path)).toBe(true);
    expect(result.path.length).toBe(2);

    expect(result.path[0].provider).toBe('Binance');

    expect(result.path[0].price).toBeInstanceOf(Price);
    expect(result.path[0].price.source).toBe('ETH');
    expect(result.path[0].price.target).toBe('BTC');
    expect(result.path[0].price.price).toBe(0.081);

    expect(result.path[0].timestamp).toBeInstanceOf(Date);

    expect(result.path[1].provider).toBe('Binance');

    expect(result.path[1].price).toBeInstanceOf(Price);
    expect(result.path[1].price.source).toBe('BTC');
    expect(result.path[1].price.target).toBe('BNB');
    expect(result.path[1].price.price).toBe(71.3);

    expect(result.path[1].timestamp).toBeInstanceOf(Date);
  });

  it('calculates price path for BTC_TO_ALTCOIN', async () => {
    binanceServiceGetPriceSpy = jest
      .spyOn(binanceService, 'getPrice')
      .mockImplementationOnce(async (source, target) => createCustomPrice({ source, target, price: 12.38 }));

    krakenServiceGetPriceSpy = jest
      .spyOn(krakenService, 'getPrice')
      .mockImplementationOnce(async (source, target) => createCustomPrice({ source, target, price: 12.38 }));

    const request = { from: 'BTC', to: 'ETH' };
    const result = await service.getPrice(request);

    expect(result.price).toBeInstanceOf(Price);
    expect(result.price.source).toBe('BTC');
    expect(result.price.target).toBe('ETH');
    expect(result.price.price).toBe(12.38);

    expect(Array.isArray(result.path)).toBe(true);
    expect(result.path.length).toBe(1);

    expect(result.path[0].provider).toBe('Binance');

    expect(result.path[0].price).toBeInstanceOf(Price);
    expect(result.path[0].price.source).toBe('BTC');
    expect(result.path[0].price.target).toBe('ETH');
    expect(result.path[0].price.price).toBe(12.38);

    expect(result.path[0].timestamp).toBeInstanceOf(Date);
  });

  it('calculates price path for MATCHING_FIAT_TO_USD_STABLE_COIN', async () => {
    const request = { from: 'USD', to: 'USDC' };
    const result = await service.getPrice(request);

    expect(result.price).toBeInstanceOf(Price);
    expect(result.price.source).toBe('USD');
    expect(result.price.target).toBe('USDC');
    expect(result.price.price).toBe(1);

    expect(Array.isArray(result.path)).toBe(true);
    expect(result.path.length).toBe(1);

    expect(result.path[0].provider).toBe('FixedPrice');

    expect(result.path[0].price).toBeInstanceOf(Price);
    expect(result.path[0].price.source).toBe('USD');
    expect(result.path[0].price.target).toBe('USDC');
    expect(result.path[0].price.price).toBe(1);

    expect(result.path[0].timestamp).toBeInstanceOf(Date);
  });

  it('calculates price path for NON_MATCHING_FIAT_TO_USD_STABLE_COIN', async () => {
    krakenServiceGetPriceSpy = jest
      .spyOn(krakenService, 'getPrice')
      .mockImplementationOnce(async (source, target) => createCustomPrice({ source, target, price: 1.1 }));

    fixerServiceGetPriceSpy = jest
      .spyOn(fixerService, 'getPrice')
      .mockImplementationOnce(async (source, target) => createCustomPrice({ source, target, price: 1.1 }));

    const request = { from: 'EUR', to: 'USDC' };
    const result = await service.getPrice(request);

    expect(fixerServiceGetPriceSpy).toHaveBeenCalledWith('EUR', 'USD');

    expect(result.price).toBeInstanceOf(Price);
    expect(result.price.source).toBe('EUR');
    expect(result.price.target).toBe('USDC');
    expect(result.price.price).toBe(1.1);

    expect(Array.isArray(result.path)).toBe(true);
    expect(result.path.length).toBe(1);

    expect(result.path[0].provider).toBe('Kraken');

    expect(result.path[0].price).toBeInstanceOf(Price);
    expect(result.path[0].price.source).toBe('EUR');
    expect(result.path[0].price.target).toBe('USDC');
    expect(result.path[0].price.price).toBe(1.1);

    expect(result.path[0].timestamp).toBeInstanceOf(Date);
  });

  it('calculates price path for NON_MATCHING_USD_STABLE_COIN_TO_USD_STABLE_COIN', async () => {
    const request = { from: 'USDT', to: 'USDC' };
    const result = await service.getPrice(request);

    expect(result.price).toBeInstanceOf(Price);
    expect(result.price.source).toBe('USDT');
    expect(result.price.target).toBe('USDC');
    expect(result.price.price).toBe(1);

    expect(Array.isArray(result.path)).toBe(true);
    expect(result.path.length).toBe(1);

    expect(result.path[0].provider).toBe('FixedPrice');

    expect(result.path[0].price).toBeInstanceOf(Price);
    expect(result.path[0].price.source).toBe('USDT');
    expect(result.path[0].price.target).toBe('USDC');
    expect(result.path[0].price.price).toBe(1);

    expect(result.path[0].timestamp).toBeInstanceOf(Date);
  });
});
