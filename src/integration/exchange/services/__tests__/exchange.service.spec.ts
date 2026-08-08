import { createMock } from '@golevelup/ts-jest';
import { Currencies, Exchange, Market, mexc } from 'ccxt';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { ExchangeService, OrderSide } from '../exchange.service';
import * as ExchangeTestModule from './exchange.test';

// neutral round numbers, in the string form ccxt publishes per network: what is asserted below is the parsing
// and the lookup, never the amount
const withdrawalMin = '0.500000000000000000';
const withdrawalMax = '50.000000000000000000';

/** A network as the venue publishes it: its own identifier, and the maximum it accepts on it. */
interface PublishedNetwork {
  rawNetwork: string;
  withdrawMax: string;
}

/** The payload MEXC answers with, as ccxt receives it: every number a string, the network name unmapped. */
function mexcCurrencyPayload(coin: string, published: PublishedNetwork[]): Record<string, unknown>[] {
  return [
    {
      coin,
      name: coin,
      networkList: published.map(({ rawNetwork, withdrawMax }) => ({
        coin,
        depositEnable: true,
        name: coin,
        netWork: rawNetwork,
        withdrawEnable: true,
        withdrawFee: '0.000100000000000000',
        withdrawIntegerMultiple: null,
        withdrawMax,
        withdrawMin: withdrawalMin,
        contract: null,
      })),
    },
  ];
}

/** Runs ccxt's own mexc parser over a raw venue payload, so the assertions see the production structure. */
function parseMexcCurrencies(coin: string, published: PublishedNetwork[]): Promise<Currencies> {
  const exchange = new mexc({ apiKey: 'key', secret: 'secret' });

  // the parser's only network call, replaced by the raw payload - fetchCurrencies answers {} without credentials
  Object.assign(exchange, {
    spotPrivateGetCapitalConfigGetall: () => Promise.resolve(mexcCurrencyPayload(coin, published)),
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
      // "is none of" would be a false statement about this list: the code is in both of them
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('matches 2 of'));
    });

    it('should warn about a network the token does not publish', async () => {
      const warn = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

      Setup.Currencies({ XMR: xmrNetwork });

      await expect(service.getWithdrawalLimits('XMR', 'BSC')).resolves.toEqual({});
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('network BSC matches none of'));
    });

    // an unpublished token is not an unresolved network: naming the network sends the reader after a spelling
    // that is not the problem
    it('should name the token when the venue publishes no such token', async () => {
      const warn = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

      Setup.Currencies({ XMR: xmrNetwork });

      await expect(service.getWithdrawalLimits('BTC', 'BTC')).resolves.toEqual({});
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('No withdrawal limits for BTC'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('publishes no such token'));
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
  // venue sends: without a unified mapping for it, key and id are that raw string verbatim. The repo asks with
  // the short code MexcService stores for the blockchain, and a venue publishes networks whose identifiers carry
  // those letters without being that network - ETHW next to Ethereum, opBNB next to Optimism, each with a
  // maximum of its own. Read off the wrong network, that maximum caps a payout to a fraction of what fits.
  describe('getWithdrawalLimits over a real ccxt payload', () => {
    const cap = { min: 0.5, max: 50 };

    // what the requested network accepts, and what a network merely carrying the same letters accepts: distinct,
    // so a lookup landing on the wrong entry shows up as the wrong number instead of as a missing cap
    const requestedMax = { withdrawMax: withdrawalMax };
    const foreignMax = { withdrawMax: '7.000000000000000000' };
    const otherMax = { withdrawMax: '900.000000000000000000' };

    it.each([
      {
        name: 'XMR',
        coin: 'XMR',
        requested: 'XMR',
        published: [{ rawNetwork: 'XMR', ...requestedMax }],
        expected: cap,
      },
      {
        name: 'Monero(XMR)',
        coin: 'XMR',
        requested: 'XMR',
        published: [{ rawNetwork: 'Monero(XMR)', ...requestedMax }],
        expected: cap,
      },
      {
        name: 'BEP20(BSC)',
        coin: 'USDT',
        requested: 'BSC',
        published: [{ rawNetwork: 'BEP20(BSC)', ...requestedMax }],
        expected: cap,
      },
      {
        name: 'Polygon(MATIC)',
        coin: 'USDT',
        requested: 'MATIC',
        published: [{ rawNetwork: 'Polygon(MATIC)', ...requestedMax }],
        expected: cap,
      },
      {
        name: 'Optimism(OP)',
        coin: 'OP',
        requested: 'OP',
        published: [{ rawNetwork: 'Optimism(OP)', ...requestedMax }],
        expected: cap,
      },
      {
        name: 'ERC20 next to ETHW',
        coin: 'ETH',
        requested: 'ETH',
        published: [
          { rawNetwork: 'ERC20', ...otherMax },
          { rawNetwork: 'ETHW', ...foreignMax },
        ],
        expected: {},
      },
      {
        name: 'Ethereum(ERC20) next to ETHW',
        coin: 'ETH',
        requested: 'ETH',
        published: [
          { rawNetwork: 'Ethereum(ERC20)', ...otherMax },
          { rawNetwork: 'ETHW', ...foreignMax },
        ],
        expected: {},
      },
      { name: 'opBNB', coin: 'OP', requested: 'OP', published: [{ rawNetwork: 'opBNB', ...foreignMax }], expected: {} },
      {
        name: 'SOLANAOLD',
        coin: 'SOL',
        requested: 'SOL',
        published: [{ rawNetwork: 'SOLANAOLD', ...foreignMax }],
        expected: {},
      },
    ])('should read $requested off the published $name', async ({ coin, requested, published, expected }) => {
      const warn = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

      jest.spyOn(exchange, 'fetchCurrencies').mockResolvedValue(await parseMexcCurrencies(coin, published));

      await expect(service.getWithdrawalLimits(coin, requested)).resolves.toEqual(expected);
      // a miss stays a logged miss, because nothing downstream can tell it from "no maximum published"
      expect(warn).toHaveBeenCalledTimes(Object.keys(expected).length ? 0 : 1);
    });

    // the published list in the warning is what an operator compares against the venue's own page: ccxt keys
    // "Ethereum(ERC20)" by its unified code "ERC20", which appears nowhere on that page
    it('should name the identifiers the venue published, not the keys ccxt replaced them with', async () => {
      const warn = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

      jest.spyOn(exchange, 'fetchCurrencies').mockResolvedValue(
        await parseMexcCurrencies('ETH', [
          { rawNetwork: 'Ethereum(ERC20)', ...otherMax },
          { rawNetwork: 'ETHW', ...foreignMax },
        ]),
      );

      await expect(service.getWithdrawalLimits('ETH', 'ETH')).resolves.toEqual({});
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('[Ethereum(ERC20),ETHW]'));
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
