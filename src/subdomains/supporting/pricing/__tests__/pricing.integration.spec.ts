import { mock } from 'jest-mock-extended';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { Price } from '../../../../integration/exchange/dto/price.dto';
import { createCustomPrice } from '../../../../integration/exchange/dto/__mocks__/price.dto.mock';
import { BinanceService } from '../../../../integration/exchange/services/binance.service';
import { BitpandaService } from '../../../../integration/exchange/services/bitpanda.service';
import { BitstampService } from '../../../../integration/exchange/services/bitstamp.service';
import { CurrencyService } from '../../../../integration/exchange/services/currency.service';
import { FixerService } from '../../../../integration/exchange/services/fixer.service';
import { FtxService } from '../../../../integration/exchange/services/ftx.service';
import { KrakenService } from '../../../../integration/exchange/services/kraken.service';
import { DfiPricingDexService } from '../services/dfi-pricing-dex.service';
import { PriceRequestContext } from '../enums';
import { PricingService } from '../services/pricing.service';

describe('Pricing Module Integration Tests', () => {
  let notificationService: NotificationService;
  let krakenService: KrakenService;
  let binanceService: BinanceService;
  let bitstampService: BitstampService;
  let bitpandaService: BitpandaService;
  let ftxService: FtxService;
  let currencyService: CurrencyService;
  let fixerService: FixerService;
  let dfiDexService: DfiPricingDexService;

  let krakenServiceGetPriceSpy: jest.SpyInstance;
  let binanceServiceGetPriceSpy: jest.SpyInstance;
  let bitstampServiceGetPriceSpy: jest.SpyInstance;
  let bitpandaServiceGetPriceSpy: jest.SpyInstance;
  let ftxServiceGetPriceSpy: jest.SpyInstance;
  let currencyServiceGetPriceSpy: jest.SpyInstance;
  let fixerServiceGetPriceSpy: jest.SpyInstance;
  let dfiDexServiceGetPriceSpy: jest.SpyInstance;

  let service: PricingService;

  beforeEach(() => {
    notificationService = mock<NotificationService>();
    krakenService = mock<KrakenService>({ name: 'Kraken' });
    binanceService = mock<BinanceService>({ name: 'Binance' });
    bitstampService = mock<BitstampService>({ name: 'Bitstamp' });
    bitpandaService = mock<BitpandaService>({ name: 'Bitpanda' });
    ftxService = mock<FtxService>({ name: 'Ftx' });
    currencyService = mock<CurrencyService>({ name: 'CurrencyService' });
    fixerService = mock<FixerService>({ name: 'FixerService' });
    dfiDexService = mock<DfiPricingDexService>({ name: 'DfiPricingDexService' });

    service = new PricingService(
      notificationService,
      krakenService,
      binanceService,
      bitstampService,
      bitpandaService,
      ftxService,
      currencyService,
      fixerService,
      dfiDexService,
    );

    krakenServiceGetPriceSpy = jest.spyOn(krakenService, 'getPrice');
    binanceServiceGetPriceSpy = jest.spyOn(binanceService, 'getPrice');
    bitstampServiceGetPriceSpy = jest.spyOn(bitstampService, 'getPrice');
    bitpandaServiceGetPriceSpy = jest.spyOn(bitpandaService, 'getPrice');
    ftxServiceGetPriceSpy = jest.spyOn(ftxService, 'getPrice');
    currencyServiceGetPriceSpy = jest.spyOn(currencyService, 'getPrice');
    fixerServiceGetPriceSpy = jest.spyOn(fixerService, 'getPrice');
    dfiDexServiceGetPriceSpy = jest.spyOn(dfiDexService, 'getPrice');
  });

  afterEach(() => {
    krakenServiceGetPriceSpy.mockClear();
    binanceServiceGetPriceSpy.mockClear();
    bitstampServiceGetPriceSpy.mockClear();
    bitpandaServiceGetPriceSpy.mockClear();
    ftxServiceGetPriceSpy.mockClear();
    currencyServiceGetPriceSpy.mockClear();
    fixerServiceGetPriceSpy.mockClear();
    dfiDexServiceGetPriceSpy.mockClear();
  });

  it('calculates price path for MATCHING_ASSETS', async () => {
    const request = { context: PriceRequestContext.BUY_CRYPTO, correlationId: '1', from: 'BTC', to: 'BTC' };
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

    const request = { context: PriceRequestContext.BUY_CRYPTO, correlationId: '1', from: 'USD', to: 'BTC' };
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

    ftxServiceGetPriceSpy = jest
      .spyOn(ftxService, 'getPrice')
      .mockImplementationOnce(async (source, target) => createCustomPrice({ source, target, price: 0.014 }));

    const request = { context: PriceRequestContext.BUY_CRYPTO, correlationId: '1', from: 'BNB', to: 'BTC' };
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
    krakenServiceGetPriceSpy = jest
      .spyOn(krakenService, 'getPrice')
      .mockImplementationOnce(async (source: string, target: string) =>
        createCustomPrice({ source, target, price: 0.000058 }),
      );

    binanceServiceGetPriceSpy = jest
      .spyOn(binanceService, 'getPrice')
      .mockImplementationOnce(async (source: string, target: string) =>
        createCustomPrice({ source, target, price: 0.000058 }),
      )
      .mockImplementationOnce(async (source: string, target: string) =>
        createCustomPrice({ source, target, price: 71.3 }),
      );

    ftxServiceGetPriceSpy = jest
      .spyOn(ftxService, 'getPrice')
      .mockImplementationOnce(async (source: string, target: string) =>
        createCustomPrice({ source, target, price: 71.3 }),
      );

    const request = { context: PriceRequestContext.BUY_CRYPTO, correlationId: '1', from: 'GBP', to: 'BNB' };
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

    ftxServiceGetPriceSpy = jest
      .spyOn(ftxService, 'getPrice')
      .mockImplementationOnce(async (source: string, target: string) =>
        createCustomPrice({ source, target, price: 0.081 }),
      )
      .mockImplementationOnce(async (source: string, target: string) =>
        createCustomPrice({ source, target, price: 71.3 }),
      );

    const request = { context: PriceRequestContext.BUY_CRYPTO, correlationId: '1', from: 'ETH', to: 'BNB' };
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

    ftxServiceGetPriceSpy = jest
      .spyOn(ftxService, 'getPrice')
      .mockImplementationOnce(async (source, target) => createCustomPrice({ source, target, price: 12.38 }));

    const request = { context: PriceRequestContext.BUY_CRYPTO, correlationId: '1', from: 'BTC', to: 'ETH' };
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
    const request = { context: PriceRequestContext.BUY_CRYPTO, correlationId: '1', from: 'USD', to: 'USDC' };
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

    const request = { context: PriceRequestContext.BUY_CRYPTO, correlationId: '1', from: 'EUR', to: 'USDC' };
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
    const request = { context: PriceRequestContext.BUY_CRYPTO, correlationId: '1', from: 'USDT', to: 'USDC' };
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

  it('calculates price path for FIAT_TO_DFI', async () => {
    krakenServiceGetPriceSpy = jest
      .spyOn(krakenService, 'getPrice')
      .mockImplementationOnce(async (source: string, target: string) =>
        createCustomPrice({ source, target, price: 0.000049 }),
      );

    dfiDexServiceGetPriceSpy = jest
      .spyOn(dfiDexService, 'getPrice')
      .mockImplementationOnce(async (source: string, target: string) =>
        createCustomPrice({ source, target, price: 23111 }),
      );

    const request = { context: PriceRequestContext.BUY_CRYPTO, correlationId: '1', from: 'EUR', to: 'DFI' };
    const result = await service.getPrice(request);

    expect(result.price).toBeInstanceOf(Price);
    expect(result.price.source).toBe('EUR');
    expect(result.price.target).toBe('DFI');
    expect(result.price.price).toBe(1.132439);

    expect(Array.isArray(result.path)).toBe(true);
    expect(result.path.length).toBe(2);

    expect(result.path[0].provider).toBe('Kraken');

    expect(result.path[0].price).toBeInstanceOf(Price);
    expect(result.path[0].price.source).toBe('EUR');
    expect(result.path[0].price.target).toBe('BTC');
    expect(result.path[0].price.price).toBe(0.000049);

    expect(result.path[0].timestamp).toBeInstanceOf(Date);

    expect(result.path[1].provider).toBe('DfiPricingDexService');

    expect(result.path[1].price).toBeInstanceOf(Price);
    expect(result.path[1].price.source).toBe('BTC');
    expect(result.path[1].price.target).toBe('DFI');
    expect(result.path[1].price.price).toBe(23111);

    expect(result.path[1].timestamp).toBeInstanceOf(Date);

    expect(result.path[1].provider).toBe('DfiPricingDexService');
  });
});
