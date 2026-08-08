import { Environment, GetConfig } from 'src/config/config';

/**
 * Everything the `Configuration` derives from `process.env` at construction time. The values below
 * are read once per `new Configuration()`, so each case sets the environment, builds a fresh config
 * and restores the environment again — a leaked variable would silently change the expectations of
 * every spec that runs after this one in the same worker.
 */
describe('Config - environment-derived values', () => {
  function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
    const backup: Record<string, string | undefined> = {};

    for (const [key, value] of Object.entries(vars)) {
      backup[key] = process.env[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    try {
      return fn();
    } finally {
      for (const [key, value] of Object.entries(backup)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  const configFor = (environment: string | undefined) => withEnv({ ENVIRONMENT: environment }, () => GetConfig());

  describe('signMessagePrefix', () => {
    // All environments share the same wallets, so a signature created on DEV would authenticate on
    // PRD too if the signed text were identical. PRD keeps the historical (unprefixed) text so
    // existing PRD signatures stay valid; every other environment signs a text PRD cannot verify.
    it('leaves the PRD sign message unprefixed', () => {
      const config = configFor(Environment.PRD);

      expect(config.signMessagePrefix).toBe('');
      expect(config.auth.signMessage.startsWith('By_signing_this_message')).toBe(true);
      expect(config.auth.signMessageGeneral.startsWith('By_signing_this_message')).toBe(true);
    });

    it('prefixes every other environment with its own name', () => {
      expect(configFor(Environment.DEV).signMessagePrefix).toBe('[dev]_');
      expect(configFor(Environment.LOC).auth.signMessage.startsWith('[loc]_By_signing_this_message')).toBe(true);
    });

    // An unset/unknown ENVIRONMENT must never accidentally produce a PRD-valid signature.
    it('treats an unset environment as non-PRD', () => {
      expect(configFor(undefined).signMessagePrefix).toBe('[undefined]_');
    });
  });

  describe('defichainAddressFormat', () => {
    it('accepts only mainnet addresses on PRD', () => {
      const address = new RegExp(`^(${configFor(Environment.PRD).defichainAddressFormat})$`);

      expect(address.test('8a2jKb8p6FWix6Q7prhWaCA8ghoTBttEBk')).toBe(true);
      expect(address.test('dak7adNN4FtfT4wADqZFPmPEDCfUfhaqD3')).toBe(true);
      // Testnet prefixes (7…/t…) must not be accepted on PRD.
      expect(address.test('7a2jKb8p6FWix6Q7prhWaCA8ghoTBttEBk')).toBe(false);
      expect(address.test('tak7adNN4FtfT4wADqZFPmPEDCfUfhaqD3')).toBe(false);
    });

    it('also accepts testnet addresses outside PRD', () => {
      const address = new RegExp(`^(${configFor(Environment.DEV).defichainAddressFormat})$`);

      expect(address.test('7a2jKb8p6FWix6Q7prhWaCA8ghoTBttEBk')).toBe(true);
      expect(address.test('tak7adNN4FtfT4wADqZFPmPEDCfUfhaqD3')).toBe(true);
      expect(address.test('8a2jKb8p6FWix6Q7prhWaCA8ghoTBttEBk')).toBe(true);
    });
  });

  describe('faucetEnabled', () => {
    it('is on for the development environments without any flag', () => {
      expect(
        withEnv({ FAUCET_ENABLED: undefined, ENVIRONMENT: Environment.DEV }, () => GetConfig().faucetEnabled),
      ).toBe(true);
      expect(
        withEnv({ FAUCET_ENABLED: undefined, ENVIRONMENT: Environment.LOC }, () => GetConfig().faucetEnabled),
      ).toBe(true);
    });

    it('is off on PRD unless FAUCET_ENABLED opts in explicitly', () => {
      expect(
        withEnv({ FAUCET_ENABLED: undefined, ENVIRONMENT: Environment.PRD }, () => GetConfig().faucetEnabled),
      ).toBe(false);
      expect(withEnv({ FAUCET_ENABLED: 'false', ENVIRONMENT: Environment.PRD }, () => GetConfig().faucetEnabled)).toBe(
        false,
      );
      expect(withEnv({ FAUCET_ENABLED: 'true', ENVIRONMENT: Environment.PRD }, () => GetConfig().faucetEnabled)).toBe(
        true,
      );
    });
  });

  describe('url', () => {
    it('points at the local port in LOC', () => {
      const config = withEnv({ ENVIRONMENT: Environment.LOC, PORT: '4000' }, () => GetConfig());

      expect(config.url()).toBe('http://localhost:4000/v1');
      // The default version is the one used when no version is passed.
      expect(config.url(config.defaultVersion)).toBe(config.url());
      expect(config.url(config.kycVersion)).toBe('http://localhost:4000/v2');
    });

    it('falls back to port 3000 when PORT is unset', () => {
      const config = withEnv({ ENVIRONMENT: Environment.LOC, PORT: undefined }, () => GetConfig());

      expect(config.port).toBe(3000);
      expect(config.url()).toBe('http://localhost:3000/v1');
    });

    it('uses the bare production host on PRD and a per-environment subdomain elsewhere', () => {
      expect(configFor(Environment.PRD).url()).toBe('https://api.dfx.swiss/v1');
      expect(configFor(Environment.DEV).url()).toBe('https://dev.api.dfx.swiss/v1');
      expect(configFor(Environment.DEV).url('2')).toBe('https://dev.api.dfx.swiss/v2');
    });
  });

  describe('frontend', () => {
    const SERVICES_URL = 'https://app.dfx.swiss;https://services.dfx.swiss';

    it('splits SERVICES_URL and takes the first entry as the canonical services url', () => {
      const config = withEnv({ SERVICES_URL }, () => GetConfig());

      expect(config.frontend.allowedUrls).toEqual(['https://app.dfx.swiss', 'https://services.dfx.swiss']);
      expect(config.frontend.services).toBe('https://app.dfx.swiss');
    });

    // Open-redirect guard: the check compares the ORIGIN, so a path or query on an allowed origin
    // passes while a look-alike host does not.
    it('allows a redirect only to a configured origin', () => {
      const config = withEnv({ SERVICES_URL }, () => GetConfig());

      expect(config.frontend.isRedirectUrlAllowed('https://app.dfx.swiss/buy?asset=BTC')).toBe(true);
      expect(config.frontend.isRedirectUrlAllowed('https://services.dfx.swiss/')).toBe(true);
      expect(config.frontend.isRedirectUrlAllowed('https://app.dfx.swiss.evil.com/buy')).toBe(false);
      expect(config.frontend.isRedirectUrlAllowed('http://app.dfx.swiss/buy')).toBe(false);
    });

    it('rejects an unparseable url instead of throwing', () => {
      const config = withEnv({ SERVICES_URL }, () => GetConfig());

      expect(config.frontend.isRedirectUrlAllowed('not-a-url')).toBe(false);
      expect(config.frontend.isRedirectUrlAllowed(undefined)).toBe(false);
    });

    it('allows nothing when SERVICES_URL is unset', () => {
      const config = withEnv({ SERVICES_URL: undefined }, () => GetConfig());

      expect(config.frontend.isRedirectUrlAllowed('https://app.dfx.swiss/buy')).toBe(false);
    });
  });

  describe('database.ssl', () => {
    // Postgres over the internal network can be run without TLS; everywhere else the connection is
    // encrypted but the server certificate is not verified (managed cert, private network).
    it('disables ssl only for the explicit SQL_SSL=false opt-out', () => {
      expect(withEnv({ SQL_SSL: 'false' }, () => GetConfig().database)).toMatchObject({ ssl: false });
      expect(withEnv({ SQL_SSL: undefined }, () => GetConfig().database)).toMatchObject({
        ssl: { rejectUnauthorized: false },
      });
      expect(withEnv({ SQL_SSL: 'true' }, () => GetConfig().database)).toMatchObject({
        ssl: { rejectUnauthorized: false },
      });
    });
  });

  describe('mail.wallet', () => {
    it('always maps the DFX and onChainLabs brands', () => {
      const wallet = withEnv({ REALUNIT_MAIL_USER: undefined }, () => GetConfig().mail.wallet);

      expect(wallet.DFX).toEqual({ template: 'user-v2' });
      expect(wallet.onchainlabs).toEqual({ template: 'onChainLabs' });
      // Without its own mailbox credentials the RealUnit brand must not be offered at all — mails
      // would otherwise be sent from a transport that has no RealUnit sender.
      expect(wallet.RealUnit).toBeUndefined();
    });

    it('adds the RealUnit brand with its own transport once REALUNIT_MAIL_USER is set', () => {
      const wallet = withEnv(
        { REALUNIT_MAIL_USER: 'info@realunit.ch', REALUNIT_MAIL_PASS: 'secret' },
        () => GetConfig().mail.wallet,
      );

      expect(wallet.RealUnit).toMatchObject({
        host: 'mail.infomaniak.com',
        user: 'info@realunit.ch',
        pass: 'secret',
        fromAddress: 'info@realunit.ch',
        template: 'realunit',
        forcedLang: 'de',
        isPreferred: true,
      });
    });
  });

  describe('scorechain limits', () => {
    // Both are deliberately without a code default: unset means undefined, and the caller fails
    // loud / falls back to manual review rather than screening against an invented threshold.
    it('leaves the risk threshold and the monthly check limit undefined when unset', () => {
      const scorechain = withEnv(
        { SCORECHAIN_RISK_THRESHOLD: undefined, SCORECHAIN_MONTHLY_CHECK_LIMIT: undefined },
        () => GetConfig().scorechain,
      );

      expect(scorechain.riskThreshold).toBeUndefined();
      expect(scorechain.monthlyCheckLimit).toBeUndefined();
    });

    it('reads both as numbers when set', () => {
      const scorechain = withEnv(
        { SCORECHAIN_RISK_THRESHOLD: '75', SCORECHAIN_MONTHLY_CHECK_LIMIT: '5000' },
        () => GetConfig().scorechain,
      );

      expect(scorechain.riskThreshold).toBe(75);
      expect(scorechain.monthlyCheckLimit).toBe(5000);
    });

    it('restores single-line PEM keys to real newlines', () => {
      const scorechain = withEnv({ SCORECHAIN_PUBLIC_KEY: 'line1<br>line2<br>line3' }, () => GetConfig().scorechain);

      expect(scorechain.publicKey).toBe('line1\nline2\nline3');
    });
  });

  describe('list-valued variables', () => {
    // Both are read as delimiter-separated lists. An unset variable has to yield an empty list, not
    // a one-element list containing an empty string — the callers iterate them without a guard.
    it('parses the known-ip allowlist and the cron delays, and yields empty lists when unset', () => {
      const set = withEnv({ REQUEST_KNOWN_IPS: '10.0.0.1,10.0.0.2', CRON_JOB_DELAY: '5;10;15' }, () => GetConfig());

      expect(set.request.knownIps).toEqual(['10.0.0.1', '10.0.0.2']);
      expect(set.cronJobDelay).toEqual([5, 10, 15]);

      const unset = withEnv({ REQUEST_KNOWN_IPS: undefined, CRON_JOB_DELAY: undefined }, () => GetConfig());

      expect(unset.request.knownIps).toEqual([]);
      expect(unset.cronJobDelay).toEqual([]);
    });

    it('turns the request limit check on only for the explicit opt-in', () => {
      expect(withEnv({ REQUEST_LIMIT_CHECK: 'true' }, () => GetConfig().request.limitCheck)).toBe(true);
      expect(withEnv({ REQUEST_LIMIT_CHECK: undefined }, () => GetConfig().request.limitCheck)).toBe(false);
    });
  });

  describe('mail.contact', () => {
    // These addresses appear as sender/recipient on customer- and monitoring-facing mails, so an
    // unset variable must fall back to the real DFX mailbox instead of an empty address.
    it('falls back to the dfx.swiss mailboxes when unset', () => {
      const contact = withEnv(
        {
          SUPPORT_MAIL: undefined,
          MONITORING_MAIL: undefined,
          LIQ_MAIL: undefined,
          NOREPLY_MAIL: undefined,
        },
        () => GetConfig().mail.contact,
      );

      expect(contact).toEqual({
        supportMail: 'support@dfx.swiss',
        monitoringMail: 'monitoring@dfx.swiss',
        liqMail: 'liq@dfx.swiss',
        noReplyMail: 'noreply@dfx.swiss',
      });
    });

    it('prefers the configured addresses', () => {
      const contact = withEnv(
        {
          SUPPORT_MAIL: 'support@example.com',
          MONITORING_MAIL: 'monitoring@example.com',
          LIQ_MAIL: 'liq@example.com',
          NOREPLY_MAIL: 'noreply@example.com',
        },
        () => GetConfig().mail.contact,
      );

      expect(contact).toEqual({
        supportMail: 'support@example.com',
        monitoringMail: 'monitoring@example.com',
        liqMail: 'liq@example.com',
        noReplyMail: 'noreply@example.com',
      });
    });
  });

  describe('realunit.brokerbotAddress', () => {
    // The Brokerbot is a live on-chain contract: pointing a development environment at the
    // production contract would trade real shares from a test run.
    it('uses the test contract in DEV/LOC and the production contract everywhere else', () => {
      const testContract = '0x39c33c2fd5b07b8e890fd2115d4adff7235fc9d2';
      const prodContract = '0xCFF32C60B87296B8c0c12980De685bEd6Cb9dD6d';

      expect(configFor(Environment.DEV).blockchain.realunit.brokerbotAddress).toBe(testContract);
      expect(configFor(Environment.LOC).blockchain.realunit.brokerbotAddress).toBe(testContract);
      expect(configFor(Environment.PRD).blockchain.realunit.brokerbotAddress).toBe(prodContract);
    });
  });
});
