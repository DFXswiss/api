import { Configuration, GetConfig } from 'src/config/config';

/**
 * The ccxt credentials are getters, not fields: they are read when an exchange client is built, so
 * a rotated key takes effect without a restart. Each getter merges the shared `exchange` defaults —
 * dropping them would silently disable ccxt's rate limiting and hammer the exchange into a ban.
 */
describe('Config exchange credentials', () => {
  const KEYS = ['KRAKEN', 'BINANCE', 'P2B', 'XT', 'MEXC'] as const;
  const backup: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of [...KEYS.flatMap((k) => [`${k}_KEY`, `${k}_SECRET`, `${k}_WITHDRAW_KEYS`]), 'EVM_WALLETS']) {
      backup[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(backup)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it.each([
    ['kraken', 'KRAKEN'],
    ['binance', 'BINANCE'],
    ['p2b', 'P2B'],
    ['xt', 'XT'],
    ['mexc', 'MEXC'],
  ] as const)('reads the %s credentials from the environment at access time', (exchange, envPrefix) => {
    const config = GetConfig();

    // Built before the variables exist — a field initializer would have frozen the undefined values.
    process.env[`${envPrefix}_KEY`] = `${envPrefix}-key`;
    process.env[`${envPrefix}_SECRET`] = `${envPrefix}-secret`;
    process.env[`${envPrefix}_WITHDRAW_KEYS`] = 'BTC:btc-withdraw-id,ETH:eth-withdraw-id';

    const args = config[exchange];

    expect(args.apiKey).toBe(`${envPrefix}-key`);
    expect(args.secret).toBe(`${envPrefix}-secret`);
    expect(args.withdrawKeys).toEqual(
      new Map([
        ['BTC', 'btc-withdraw-id'],
        ['ETH', 'eth-withdraw-id'],
      ]),
    );

    // Shared ccxt defaults must survive the merge.
    expect(args.enableRateLimit).toBe(true);
    expect(args.rateLimit).toBe(config.exchange.rateLimit);
  });

  it('yields an empty withdraw-key map when the variable is unset', () => {
    expect(GetConfig().kraken.withdrawKeys).toEqual(new Map());
  });

  it('tolerates a withdraw-key entry without a value', () => {
    // A trailing comma or a bare currency must not blow up the whole exchange client.
    process.env.KRAKEN_WITHDRAW_KEYS = 'BTC:btc-withdraw-id,ETH';

    expect(GetConfig().kraken.withdrawKeys).toEqual(
      new Map([
        ['BTC', 'btc-withdraw-id'],
        ['ETH', undefined],
      ]),
    );
  });

  it('keeps binance on string quotes so amounts never lose precision', () => {
    expect(GetConfig().binance.quoteJsonNumbers).toBe(false);
  });

  // MEXC rejects signed requests (error 700003) when the round-trip latency exceeds the recvWindow,
  // so it is pinned to the maximum the exchange allows.
  it('gives mexc the maximum recvWindow and its own timeout', () => {
    const config = GetConfig();

    expect(config.mexc.options).toEqual({ recvWindow: config.mexcRecvWindow });
    expect(config.mexcRecvWindow).toBe(60000);
    expect(config.mexc.timeout).toBe(30_000);
  });

  describe('evmWallets', () => {
    it('parses the wallet list into an address -> key map', () => {
      process.env.EVM_WALLETS = '0xaaa:priv-a,0xbbb:priv-b';

      expect(GetConfig().evmWallets).toEqual(
        new Map([
          ['0xaaa', 'priv-a'],
          ['0xbbb', 'priv-b'],
        ]),
      );
    });

    it('is an empty map when unset', () => {
      expect(GetConfig().evmWallets).toEqual(new Map());
    });
  });

  it('shares one rate-limit policy across all exchanges', () => {
    const config = new Configuration();

    expect(config.exchange).toEqual({ enableRateLimit: true, rateLimit: 500, timeout: 30000 });
  });
});
