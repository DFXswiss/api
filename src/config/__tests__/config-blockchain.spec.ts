import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GetConfig } from 'src/config/config';
import { ClementineNetwork } from 'src/integration/blockchain/clementine/clementine-client';

describe('Config.blockchain', () => {
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

  /**
   * Every chain derives its per-user deposit address from one seed plus an account index. The
   * factories exist so no caller ever pairs a chain with the seed of another chain — which would
   * derive addresses DFX cannot spend from.
   */
  describe('wallet account factories', () => {
    const SEEDS = {
      EVM_DEPOSIT_SEED: 'evm-deposit-seed',
      EVM_CUSTODY_SEED: 'evm-custody-seed',
      SOLANA_WALLET_SEED: 'solana-seed',
      TRON_WALLET_SEED: 'tron-seed',
      CARDANO_WALLET_SEED: 'cardano-seed',
      ICP_WALLET_SEED: 'icp-seed',
    };

    it('pairs each chain with its own seed and passes the account index through', () => {
      withEnv(SEEDS, () => {
        const { evm, solana, tron, cardano, internetComputer } = GetConfig().blockchain;

        expect(evm.walletAccount(3)).toEqual({ seed: 'evm-deposit-seed', index: 3 });
        expect(solana.walletAccount(4)).toEqual({ seed: 'solana-seed', index: 4 });
        expect(tron.walletAccount(5)).toEqual({ seed: 'tron-seed', index: 5 });
        expect(cardano.walletAccount(6)).toEqual({ seed: 'cardano-seed', index: 6 });
        expect(internetComputer.walletAccount(7)).toEqual({ seed: 'icp-seed', index: 7 });
      });
    });

    // Custody balances are held on a separate seed from the deposit addresses; mixing the two would
    // put customer deposits and custody holdings on the same derivation path.
    it('derives EVM custody accounts from the custody seed, not the deposit seed', () => {
      withEnv(SEEDS, () => {
        const { evm } = GetConfig().blockchain;

        expect(evm.custodyAccount(0)).toEqual({ seed: 'evm-custody-seed', index: 0 });
        expect(evm.custodyAccount(0).seed).not.toBe(evm.walletAccount(0).seed);
      });
    });
  });

  describe('lightning certificate', () => {
    let dir: string;

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'dfx-lnd-cert-'));
    });

    afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('reads the live LND certificate from the mounted path', () => {
      const path = join(dir, 'tls.cert');
      writeFileSync(path, '-----BEGIN CERTIFICATE-----\nlnd\n-----END CERTIFICATE-----\n');

      const certificate = withEnv(
        { LIGHTNING_API_CERTIFICATE_PATH: path },
        () => GetConfig().blockchain.lightning.certificate,
      );

      expect(certificate).toContain('BEGIN CERTIFICATE');
    });

    // A configured but broken mount must surface at boot instead of being masked by the env
    // fallback — silently talking to LND without the pinned cert is the failure to avoid.
    it('throws when the configured certificate path cannot be read', () => {
      expect(() => withEnv({ LIGHTNING_API_CERTIFICATE_PATH: join(dir, 'missing.cert') }, () => GetConfig())).toThrow(
        /ENOENT/,
      );
    });

    it('falls back to the single-line env certificate when no path is mounted', () => {
      const certificate = withEnv(
        { LIGHTNING_API_CERTIFICATE_PATH: undefined, LIGHTNING_API_CERTIFICATE: 'line1<br>line2' },
        () => GetConfig().blockchain.lightning.certificate,
      );

      expect(certificate).toBe('line1\nline2');
    });

    it('is undefined when neither a path nor an inline certificate is configured', () => {
      const certificate = withEnv(
        { LIGHTNING_API_CERTIFICATE_PATH: undefined, LIGHTNING_API_CERTIFICATE: undefined },
        () => GetConfig().blockchain.lightning.certificate,
      );

      expect(certificate).toBeUndefined();
    });
  });

  describe('arkade', () => {
    // Arkade was renamed from "Ark"; the old ARK_* variables stay supported so a deployment that
    // has not been migrated yet keeps working instead of silently losing its key.
    it('prefers the ARKADE_* variables and falls back to the legacy ARK_* ones', () => {
      const both = withEnv(
        {
          ARKADE_PRIVATE_KEY: 'new-key',
          ARK_PRIVATE_KEY: 'legacy-key',
          ARKADE_SERVER_URL: 'https://new.example',
          ARK_SERVER_URL: 'https://legacy.example',
        },
        () => GetConfig().blockchain.arkade,
      );

      expect(both).toEqual({ arkadePrivateKey: 'new-key', arkadeServerUrl: 'https://new.example' });

      const legacyOnly = withEnv(
        {
          ARKADE_PRIVATE_KEY: undefined,
          ARK_PRIVATE_KEY: 'legacy-key',
          ARKADE_SERVER_URL: undefined,
          ARK_SERVER_URL: 'https://legacy.example',
        },
        () => GetConfig().blockchain.arkade,
      );

      expect(legacyOnly).toEqual({ arkadePrivateKey: 'legacy-key', arkadeServerUrl: 'https://legacy.example' });
    });

    it('defaults the server url to the public Arkade endpoint', () => {
      const arkade = withEnv(
        {
          ARKADE_PRIVATE_KEY: undefined,
          ARK_PRIVATE_KEY: undefined,
          ARKADE_SERVER_URL: undefined,
          ARK_SERVER_URL: undefined,
        },
        () => GetConfig().blockchain.arkade,
      );

      expect(arkade).toEqual({ arkadePrivateKey: undefined, arkadeServerUrl: 'https://arkade.computer' });
    });
  });

  describe('clementine', () => {
    it('defaults to the bitcoin mainnet CLI setup', () => {
      const clementine = withEnv(
        {
          CLEMENTINE_NETWORK: undefined,
          CLEMENTINE_CLI_PATH: undefined,
          CLEMENTINE_HOME_DIR: undefined,
          CLEMENTINE_TIMEOUT_MS: undefined,
          CLEMENTINE_SIGNING_TIMEOUT_MS: undefined,
          CLEMENTINE_CLI_VERSION: undefined,
          CLEMENTINE_PASSPHRASE: undefined,
        },
        () => GetConfig().blockchain.clementine,
      );

      expect(clementine).toMatchObject({
        network: ClementineNetwork.BITCOIN,
        cliPath: 'clementine-cli',
        homeDir: '/home',
        timeoutMs: 60000,
        // Signing takes several rounds of interaction, so it gets a much wider budget than a
        // plain CLI call.
        signingTimeoutMs: 300000,
        expectedVersion: '',
        passphrase: '',
      });
    });

    it('takes network and timeouts from the environment', () => {
      const clementine = withEnv(
        {
          CLEMENTINE_NETWORK: ClementineNetwork.TESTNET4,
          CLEMENTINE_TIMEOUT_MS: '5000',
          CLEMENTINE_SIGNING_TIMEOUT_MS: '15000',
        },
        () => GetConfig().blockchain.clementine,
      );

      expect(clementine).toMatchObject({
        network: ClementineNetwork.TESTNET4,
        timeoutMs: 5000,
        signingTimeoutMs: 15000,
      });
    });
  });

  /**
   * The W2W gas wallet pays the gas for user-initiated REALU transfers. An unset or nonsensical
   * low-balance threshold would disable the "wallet is running dry" alarm without any signal, so
   * the value is validated while the configuration is built — the boot fails instead.
   */
  describe('realunit.w2wGasLowBalanceThreshold', () => {
    const VAR = 'REALUNIT_W2W_GAS_LOW_BALANCE_THRESHOLD';

    it('reads a positive threshold', () => {
      expect(withEnv({ [VAR]: '0.25' }, () => GetConfig().blockchain.realunit.w2wGasLowBalanceThreshold)).toBe(0.25);
    });

    it('refuses to build a configuration without the threshold', () => {
      expect(() => withEnv({ [VAR]: undefined }, () => GetConfig())).toThrow(`Missing ${VAR}`);
    });

    it.each(['abc', '', '0', '-1', 'Infinity'])('refuses the unusable threshold %p', (value) => {
      expect(() => withEnv({ [VAR]: value }, () => GetConfig())).toThrow(`Invalid ${VAR}: ${value}`);
    });
  });
});
