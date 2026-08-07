import { createMock } from '@golevelup/ts-jest';
import { Currencies, Exchange, Market } from 'ccxt';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { ExchangeService, OrderSide } from '../exchange.service';
import * as ExchangeTestModule from './exchange.test';

describe('ExchangeService', () => {
  let service: ExchangeService;

  let exchange: Exchange;

  beforeEach(() => {
    exchange = createMock<Exchange>();

    jest.spyOn(ExchangeTestModule, 'TestExchange').mockImplementation(() => exchange);

    service = new ExchangeTestModule.TestExchangeService(
      ExchangeTestModule.TestExchange,
      undefined,
      new QueueHandler(undefined, undefined),
    );
  });

  afterEach(() => {
    service['queue'].stop();
  });

  const Setup = {
    Markets: () => {
      jest.spyOn(exchange, 'fetchMarkets').mockResolvedValue([
        { symbol: 'BTC/EUR', active: true },
        { symbol: 'BTC/CHF', active: true },
        { symbol: 'ETH/EUR', active: true },
      ] as Market[]);
    },
    // `aggregateMax` is the token-level maximum ccxt derives as the highest of all networks — never a usable cap
    Currencies: (networks: Record<string, unknown>, aggregateMax?: number) => {
      jest.spyOn(exchange, 'fetchCurrencies').mockResolvedValue({
        XMR: { limits: { withdraw: { min: 0.5, max: aggregateMax } }, networks },
      } as unknown as Currencies);
    },
  };

  const XmrNetwork = { id: 'XMR', limits: { withdraw: { min: 0.01, max: 100 } } };

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should not be configured without credentials', () => {
    expect(service.isConfigured).toBe(false);
  });

  it('should not be configured with only an apiKey', () => {
    service = new ExchangeTestModule.TestExchangeService(
      ExchangeTestModule.TestExchange,
      { apiKey: 'key' },
      new QueueHandler(undefined, undefined),
    );

    expect(service.isConfigured).toBe(false);
  });

  it('should be configured with apiKey and secret', () => {
    service = new ExchangeTestModule.TestExchangeService(
      ExchangeTestModule.TestExchange,
      { apiKey: 'key', secret: 'secret' },
      new QueueHandler(undefined, undefined),
    );

    expect(service.isConfigured).toBe(true);
  });

  it('should return BTC/EUR and buy', async () => {
    Setup.Markets();

    await expect(service.getTradePair('EUR', 'BTC')).resolves.toEqual({ pair: 'BTC/EUR', direction: OrderSide.BUY });
  });

  it('should return BTC/EUR and sell', async () => {
    Setup.Markets();

    await expect(service.getTradePair('BTC', 'EUR')).resolves.toEqual({
      pair: 'BTC/EUR',
      direction: OrderSide.SELL,
    });
  });

  describe('getWithdrawalLimits', () => {
    it('should return the limits published for the requested network', async () => {
      Setup.Currencies({ XMR: XmrNetwork });

      await expect(service.getWithdrawalLimits('XMR', 'XMR')).resolves.toEqual({ min: 0.01, max: 100 });
    });

    it('should ignore the token-level aggregate over all networks', async () => {
      Setup.Currencies({ XMR: XmrNetwork, BSC: { id: 'BSC', limits: { withdraw: { min: 0.02, max: 500 } } } }, 500);

      await expect(service.getWithdrawalLimits('XMR', 'XMR')).resolves.toEqual({ min: 0.01, max: 100 });
    });

    it('should match the network by id, not by dictionary key', async () => {
      Setup.Currencies({ 'Monero(XMR)': XmrNetwork });

      await expect(service.getWithdrawalLimits('XMR', 'XMR')).resolves.toEqual({ min: 0.01, max: 100 });
    });

    it('should fall back to the dictionary key when no id matches', async () => {
      Setup.Currencies({ XMR: { limits: { withdraw: { min: 0.01, max: 100 } } } });

      await expect(service.getWithdrawalLimits('XMR', 'XMR')).resolves.toEqual({ min: 0.01, max: 100 });
    });

    it('should return no limits for a network the token does not publish', async () => {
      Setup.Currencies({ XMR: XmrNetwork });

      await expect(service.getWithdrawalLimits('XMR', 'BSC')).resolves.toEqual({});
    });

    it('should not query the venue without a network', async () => {
      Setup.Currencies({ XMR: XmrNetwork });

      await expect(service.getWithdrawalLimits('XMR')).resolves.toEqual({});
      expect(exchange.fetchCurrencies).not.toHaveBeenCalled();
    });

    it('should return no limits when the venue answers without currencies', async () => {
      jest.spyOn(exchange, 'fetchCurrencies').mockResolvedValue({} as Currencies);

      await expect(service.getWithdrawalLimits('XMR', 'XMR')).resolves.toEqual({});
    });

    it('should return no limits when the query fails', async () => {
      jest.spyOn(exchange, 'fetchCurrencies').mockRejectedValue(new Error('Invalid API-key'));

      await expect(service.getWithdrawalLimits('XMR', 'XMR')).resolves.toEqual({});
    });

    it('should treat a published limit of zero as unknown', async () => {
      Setup.Currencies({ XMR: { id: 'XMR', limits: { withdraw: { min: 0, max: 0 } } } });

      await expect(service.getWithdrawalLimits('XMR', 'XMR')).resolves.toEqual({});
    });

    it('should query the venue only once for repeated calls', async () => {
      Setup.Currencies({ XMR: XmrNetwork });

      await service.getWithdrawalLimits('XMR', 'XMR');

      await expect(service.getWithdrawalLimits('XMR', 'XMR')).resolves.toEqual({ min: 0.01, max: 100 });
      expect(exchange.fetchCurrencies).toHaveBeenCalledTimes(1);
    });
  });
});
