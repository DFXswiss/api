import { createMock } from '@golevelup/ts-jest';
import { Currencies, Exchange, Market, mexc } from 'ccxt';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { ExchangeService, OrderSide } from '../exchange.service';
import * as ExchangeTestModule from './exchange.test';

// neutral round numbers, in the string form ccxt publishes per network: what is asserted below is the parsing
// and the lookup, never the amount
const withdrawalMin = '0.500000000000000000';
const withdrawalMax = '50.000000000000000000';

/** The payload MEXC answers with, as ccxt receives it: every number a string, the network name unmapped. */
function mexcCurrencyPayload(rawNetwork: string): Record<string, unknown>[] {
  return [
    {
      coin: 'XMR',
      name: 'Monero',
      networkList: [
        {
          coin: 'XMR',
          depositEnable: true,
          name: 'Monero',
          netWork: rawNetwork,
          withdrawEnable: true,
          withdrawFee: '0.000100000000000000',
          withdrawIntegerMultiple: null,
          withdrawMax: withdrawalMax,
          withdrawMin: withdrawalMin,
          contract: null,
        },
      ],
    },
  ];
}

/** Runs ccxt's own mexc parser over a raw venue payload, so the assertions see the production structure. */
function parseMexcCurrencies(rawNetwork: string): Promise<Currencies> {
  const exchange = new mexc({ apiKey: 'key', secret: 'secret' });

  // the parser's only network call, replaced by the raw payload - fetchCurrencies answers {} without credentials
  Object.assign(exchange, {
    spotPrivateGetCapitalConfigGetall: () => Promise.resolve(mexcCurrencyPayload(rawNetwork)),
  });

  return exchange.fetchCurrencies();
}

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

  const xmrNetwork = {
    id: 'XMR',
    network: 'XMR',
    info: { netWork: 'XMR' },
    limits: { withdraw: { min: withdrawalMin, max: withdrawalMax } },
  };

  const longFormNetwork = {
    id: 'Monero(XMR)',
    network: 'Monero(XMR)',
    info: { netWork: 'Monero(XMR)' },
    limits: { withdraw: { min: withdrawalMin, max: withdrawalMax } },
  };

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
      Setup.Currencies({ XMR: xmrNetwork });

      await expect(service.getWithdrawalLimits('XMR', 'XMR')).resolves.toEqual({ min: 0.5, max: 50 });
    });

    // ccxt builds the per-network limits with `safeString`: passed on unparsed, they are compared
    // lexicographically, where "20" sorts after "100" and inverts every check made on them
    it('should parse the string limits ccxt publishes per network into numbers', async () => {
      Setup.Currencies({ XMR: { id: 'XMR', limits: { withdraw: { min: '20.0', max: '100.0' } } } });

      const limits = await service.getWithdrawalLimits('XMR', 'XMR');

      expect(limits).toEqual({ min: 20, max: 100 });
      expect(limits.min > limits.max).toBe(false);
    });

    it('should ignore a limit that is not a number', async () => {
      Setup.Currencies({ XMR: { id: 'XMR', limits: { withdraw: { min: 'unlimited', max: 'unlimited' } } } });

      await expect(service.getWithdrawalLimits('XMR', 'XMR')).resolves.toEqual({});
    });

    it('should ignore the token-level aggregate over all networks', async () => {
      Setup.Currencies(
        { XMR: xmrNetwork, BSC: { id: 'BSC', limits: { withdraw: { min: '2.0', max: '500.0' } } } },
        500,
      );

      await expect(service.getWithdrawalLimits('XMR', 'XMR')).resolves.toEqual({ min: 0.5, max: 50 });
    });

    it('should match the network by id, not by dictionary key', async () => {
      Setup.Currencies({ 'unified-code': xmrNetwork });

      await expect(service.getWithdrawalLimits('XMR', 'XMR')).resolves.toEqual({ min: 0.5, max: 50 });
    });

    it('should match the venue long form that embeds the requested code', async () => {
      Setup.Currencies({ 'Monero(XMR)': longFormNetwork });

      await expect(service.getWithdrawalLimits('XMR', 'XMR')).resolves.toEqual({ min: 0.5, max: 50 });
    });

    it('should match the raw network field when neither key nor id carries it', async () => {
      Setup.Currencies({ 'unified-code': { id: 'unified-id', info: { netWork: 'XMR' }, limits: xmrNetwork.limits } });

      await expect(service.getWithdrawalLimits('XMR', 'XMR')).resolves.toEqual({ min: 0.5, max: 50 });
    });

    it('should match the dictionary key when the entry carries no id', async () => {
      Setup.Currencies({ XMR: { limits: xmrNetwork.limits } });

      await expect(service.getWithdrawalLimits('XMR', 'XMR')).resolves.toEqual({ min: 0.5, max: 50 });
    });

    it('should not guess when several networks embed the requested code', async () => {
      const warn = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

      Setup.Currencies({ 'Monero(XMR)': longFormNetwork, 'Wrapped(XMR)': { id: 'Wrapped(XMR)' } });

      await expect(service.getWithdrawalLimits('XMR', 'XMR')).resolves.toEqual({});
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('should warn about a network the token does not publish', async () => {
      const warn = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

      Setup.Currencies({ XMR: xmrNetwork });

      await expect(service.getWithdrawalLimits('XMR', 'BSC')).resolves.toEqual({});
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('should not warn when the network resolves without a published maximum', async () => {
      const warn = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

      Setup.Currencies({ XMR: { id: 'XMR', limits: {} } });

      await expect(service.getWithdrawalLimits('XMR', 'XMR')).resolves.toEqual({});
      expect(warn).not.toHaveBeenCalled();
    });

    it('should not query the venue without a network', async () => {
      Setup.Currencies({ XMR: xmrNetwork });

      await expect(service.getWithdrawalLimits('XMR')).resolves.toEqual({});
      expect(exchange.fetchCurrencies).not.toHaveBeenCalled();
    });

    // ccxt answers with an empty dictionary, and no error, when the venue publishes its currencies to
    // authenticated callers only and no credentials are configured
    it('should warn when the venue answers without currencies', async () => {
      const warn = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

      jest.spyOn(exchange, 'fetchCurrencies').mockResolvedValue({} as Currencies);

      await expect(service.getWithdrawalLimits('XMR', 'XMR')).resolves.toEqual({});
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('should warn when the query fails', async () => {
      const warn = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

      jest.spyOn(exchange, 'fetchCurrencies').mockRejectedValue(new Error('Invalid API-key'));

      await expect(service.getWithdrawalLimits('XMR', 'XMR')).resolves.toEqual({});
      expect(warn).toHaveBeenCalled();
    });

    it('should treat a published limit of zero as unknown', async () => {
      Setup.Currencies({ XMR: { id: 'XMR', limits: { withdraw: { min: '0', max: '0' } } } });

      await expect(service.getWithdrawalLimits('XMR', 'XMR')).resolves.toEqual({});
    });

    it('should query the venue only once for repeated calls', async () => {
      Setup.Currencies({ XMR: xmrNetwork });

      await service.getWithdrawalLimits('XMR', 'XMR');

      await expect(service.getWithdrawalLimits('XMR', 'XMR')).resolves.toEqual({ min: 0.5, max: 50 });
      expect(exchange.fetchCurrencies).toHaveBeenCalledTimes(1);
    });
  });

  // ccxt's mexc parser decides what `networks` is keyed by, and its answer depends on the raw network string the
  // venue sends: without a unified mapping for it, key and id are that raw string verbatim. Both spellings are in
  // the wild for the same network, and the repo asks with the short one.
  describe('getWithdrawalLimits over a real ccxt payload', () => {
    it.each(['XMR', 'Monero(XMR)'])('should find the limits for raw network %s', async (rawNetwork) => {
      jest.spyOn(exchange, 'fetchCurrencies').mockResolvedValue(await parseMexcCurrencies(rawNetwork));

      await expect(service.getWithdrawalLimits('XMR', 'XMR')).resolves.toEqual({ min: 0.5, max: 50 });
    });
  });

  describe('withdrawFunds', () => {
    it('should re-read the limits after a withdrawal was rejected for exceeding the maximum', async () => {
      jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

      Setup.Currencies({ XMR: xmrNetwork });
      jest
        .spyOn(exchange, 'withdraw')
        .mockRejectedValue(
          new Error('mexc {"code":10255,"msg":"Withdrawal shall not be greater than the Max amount"}'),
        );

      await expect(service.getWithdrawalLimits('XMR', 'XMR')).resolves.toEqual({ min: 0.5, max: 50 });
      await expect(service.withdrawFunds('XMR', 50, 'address', 'key', 'XMR')).rejects.toThrow('10255');
      await expect(service.getWithdrawalLimits('XMR', 'XMR')).resolves.toEqual({ min: 0.5, max: 50 });

      expect(exchange.fetchCurrencies).toHaveBeenCalledTimes(2);
    });

    it('should keep the cached limits when a withdrawal fails for another reason', async () => {
      Setup.Currencies({ XMR: xmrNetwork });
      jest.spyOn(exchange, 'withdraw').mockRejectedValue(new Error('Insufficient funds'));

      await service.getWithdrawalLimits('XMR', 'XMR');
      await expect(service.withdrawFunds('XMR', 50, 'address', 'key', 'XMR')).rejects.toThrow('Insufficient funds');
      await service.getWithdrawalLimits('XMR', 'XMR');

      expect(exchange.fetchCurrencies).toHaveBeenCalledTimes(1);
    });
  });
});
