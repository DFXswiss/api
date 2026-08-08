import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { TypeOrmLogger } from 'src/shared/services/typeorm-logger';
import { PaymentStandard } from 'src/subdomains/core/payment-link/enums';
import { KycFileBlob } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { ContentType } from 'src/subdomains/generic/kyc/enums/content-type.enum';
import { FileCategory } from 'src/subdomains/generic/kyc/enums/file-category.enum';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { KycIdentificationType } from 'src/subdomains/generic/user/models/user-data/kyc-identification-type.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import JSZip from 'jszip';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { Configuration, Environment, GetConfig, assertValidStorageCombo } from '../config';

describe('Config', () => {
  it('should wire the database logger so pg NOTICEs reach stdout/Loki', () => {
    // Pins the prod wiring: without logNotifications the driver never forwards RAISE NOTICE, and without
    // the TypeOrmLogger instance the default console logger swallows level 'info' when SQL_LOGGING is
    // unset — either regression would silently discard migration reconciliation counters while every
    // logger unit/integration test stays green.
    const database = GetConfig().database as PostgresConnectionOptions;

    expect(database.logNotifications).toBe(true);
    expect(database.logger).toBeInstanceOf(TypeOrmLogger);
  });

  it('should match all addresses', async () => {
    process.env.ENVIRONMENT = 'prd';

    const addressFormat = GetConfig().formats.address;
    const addrExp = new RegExp(addressFormat);

    // Bitcoin
    expect(addrExp.test('12uP2ZgBQ7AG56yLdzW4fyyPzELQmitPBB')).toEqual(true);
    expect(addrExp.test('31h4ReawbCsXXU5iX9YjPDHjPQmvymCyVo')).toEqual(true);
    expect(addrExp.test('bc1q04fhuhexv662d58y205zhngrkryfpr4lmfxedz')).toEqual(true);
    expect(addrExp.test('bc1qwqdg6squsna38e46795at95yu9atm8azzmyvckulcc7kytlcckxswvvzej')).toEqual(true);

    // Taproot
    expect(addrExp.test('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297')).toEqual(true);

    // Silent Payment (BIP-352)
    expect(
      addrExp.test(
        'sp1qq09fnmc3dlpkxvz0cder74ys7qnjl6t2k9j936fzqeevc5pgrldp5q7r6f8rx8ppcnuq3gdkqp5qtv8nlgcx7z5mlen2ek57ctjffprec5vyplxz',
      ),
    ).toEqual(true);

    // Lightning
    expect(addrExp.test('LNURL1DP68GURN8GHJ77P09EMK2MRV944KUMMHDCHKCMN4WFK8QTMDUMFNU2')).toEqual(true);

    expect(
      addrExp.test(
        'LNURL1DP68GURN8GHJ7ARGD9EJ66TN94SJ6AN9WFUJ6MR0DENJ6ER0D4SKJM3DDESK6EFWVDHK6TEWWAJKCMPDDDHX7AMW9AKXUATJD3CZ7ARGD9EJ66TN94SKCUM094SJ6AN9WFUJ6MR0DENJ6ATNV4EZ6MNPD4JSCYAVPM',
      ),
    ).toEqual(true);

    expect(addrExp.test('LNNID028BA6A31FF9E824A945DE0E7B7C9F458195F4110A1FF161A599248F3AD9D1B1FD')).toEqual(true);

    expect(
      addrExp.test(
        'LNDHUB1D3HXG6R4VGAZ7TMFDEMX76TRV5AXGDMZVDSNXWP3XQ6NJDFSV93XXETPXA3XYCF5V56RVDFCX9JKVDP58YMXGWPJX4SNXVF4XQERGENPX4QXSAR5WPEN5TE0XYERGDTRVFSNGC3JX3SKVVP3XGHXZTTKV4E8JTTVDAHXWTTPV3J8YETNWVH8VMMVW3SKWETPWPCZU6T09AKXUERGW43Z7ETCWSHST8R565',
      ),
    ).toEqual(true);

    // Ethereum
    expect(addrExp.test('0x000341705b2bED92e0D6938Cc206fB0CD7F57d74')).toEqual(true);

    // Monero
    expect(
      addrExp.test('43W78fdGV2ncSmu8EbSUTZU53huYiS5HoVDVvxaRrUpz3syHrBfsAQPGbMnhtY19xk6dXJSMoPt9wZCksK98ncq7NUSFTBU'),
    ).toEqual(true);
    expect(
      addrExp.test('88q8rtLE9zsPjdvoY4WmBFJ9WXj3zghijeeDbihZAFg8EDPdJPhYj5Q9w9K1k5ghSQgyALKHrQiNUYdG2An8PSFnBwFpvC1'),
    ).toEqual(true);

    // Liquid
    expect(addrExp.test('VTpwKsrwasw7VnNf4GHMmcjNY3MR2Q81GaxDv7EyhVS8rzj5exX5b5PF6g29Szb4jrMqKSUwP2ZGnXt4')).toEqual(
      true,
    );
    expect(addrExp.test('VJL8GbXwhTdzGtNEqRTLGvd3ELddCstc3kwCHgymUEkBDgB1goXxa2nPeyzyTuSRXu5ic3miVt4JGdfQ')).toEqual(
      true,
    );

    // Arweave
    expect(addrExp.test('RKYXQy00iKp-HmeYqsiXA_pDZTfdDyT-y-Brg93lgMk')).toEqual(true);
    expect(addrExp.test('w5AtiFsNvORfcRtikbdrp2tzqixb05vdPw-ZhgVkD70')).toEqual(true);

    // Solana
    expect(addrExp.test('LUKAzPV8dDbVykTVT14pCGKzFfNcgZgRbAXB8AGdKx3')).toEqual(true);
    expect(addrExp.test('oQPnhXAbLbMuKHESaGrbXT17CyvWCpLyERSJA9HCYd7')).toEqual(true);

    // Defichain
    expect(addrExp.test('8a2jKb8p6FWix6Q7prhWaCA8ghoTBttEBk')).toEqual(true);
    expect(addrExp.test('dak7adNN4FtfT4wADqZFPmPEDCfUfhaqD3')).toEqual(true);
    expect(addrExp.test('df1q000q5sykp9hwq3tyvucynl03sm9yt6y0np05ct')).toEqual(true);
  });

  describe('helpers and getters', () => {
    it('classifies domestic CH/LI IBANs and rejects others', () => {
      const config = GetConfig();
      expect(config.isDomesticIban('CH9300762011623852957')).toBe(true);
      expect(config.isDomesticIban('LI21088100002324013AA')).toBe(true);
      expect(config.isDomesticIban('DE89370400440532013000')).toBe(false);
      expect(config.isDomesticIban(undefined as unknown as string)).toBe(false);
    });

    it('resolves country-specific currency and language defaults', () => {
      const config = GetConfig();
      expect(config.defaults.forCountry(undefined)).toEqual({ currency: 'EUR', language: 'EN' });
      expect(config.defaults.forCountry('CH')).toEqual({ currency: 'CHF', language: 'EN' });
      expect(config.defaults.forCountry('LI')).toEqual({ currency: 'CHF', language: 'DE' });
      expect(config.defaults.forCountry('DE')).toEqual({ currency: 'EUR', language: 'DE' });
      expect(config.defaults.forCountry('XX')).toEqual({ currency: 'EUR', language: 'EN' });
    });

    it('exposes the i18n fallback resolver', () => {
      const config = GetConfig();
      const resolve = (config.i18n.resolvers as { resolve: () => string }[])[0].resolve;
      expect(resolve()).toBe(config.i18n.fallbackLanguage);
    });

    it('checks frontend redirect allowlist and rejects invalid URLs', () => {
      const config = GetConfig();
      const origin = config.frontend.allowedUrls[0];
      if (origin) {
        expect(config.frontend.isRedirectUrlAllowed(`${origin}/path`)).toBe(true);
      }
      expect(config.frontend.isRedirectUrlAllowed('not-a-url')).toBe(false);
      expect(config.frontend.isRedirectUrlAllowed('https://evil.example/')).toBe(false);
    });

    it('returns payment confirmation and payout thresholds per chain', () => {
      const config = GetConfig();
      expect(config.payment.minConfirmations(Blockchain.ETHEREUM)).toBe(6);
      expect(config.payment.minConfirmations(Blockchain.BITCOIN)).toBe(6);
      expect(config.payment.minConfirmations(Blockchain.INTERNET_COMPUTER)).toBe(1);
      expect(config.payment.minConfirmations(Blockchain.ARBITRUM)).toBe(100);

      expect(config.payment.cryptoPayoutMinAmount(Blockchain.LIGHTNING)).toBe(0);
      expect(config.payment.cryptoPayoutMinAmount(Blockchain.ETHEREUM)).toBe(
        +(process.env.PAYMENT_CRYPTO_PAYOUT_MIN ?? 1000),
      );
    });

    it('selects forex fee and quote timeout by payment standard', () => {
      const config = GetConfig();
      const chf = { name: 'CHF' } as any;
      const zchf = { name: 'ZCHF' } as any;
      const eth = { name: 'ETH' } as any;

      expect(config.payment.forexFee(PaymentStandard.OPEN_CRYPTO_PAY, chf, zchf)).toBe(0);
      expect(config.payment.forexFee(PaymentStandard.OPEN_CRYPTO_PAY, chf, { name: 'VCHF' } as any)).toBe(0);
      expect(config.payment.forexFee(PaymentStandard.PAY_TO_ADDRESS, chf, eth)).toBe(config.payment.addressForexFee);
      expect(config.payment.forexFee(PaymentStandard.OPEN_CRYPTO_PAY, chf, eth)).toBe(config.payment.defaultForexFee);

      expect(config.payment.quoteTimeout(PaymentStandard.PAY_TO_ADDRESS)).toBe(config.payment.addressQuoteTimeout);
      expect(config.payment.quoteTimeout(PaymentStandard.OPEN_CRYPTO_PAY)).toBe(config.payment.defaultQuoteTimeout);
    });

    it('builds wallet accounts for each chain seed helper', () => {
      const config = GetConfig();
      expect(config.blockchain.evm.walletAccount(3)).toEqual({
        seed: config.blockchain.evm.depositSeed,
        index: 3,
      });
      expect(config.blockchain.evm.custodyAccount(4)).toEqual({
        seed: config.blockchain.evm.custodySeed,
        index: 4,
      });
      expect(config.blockchain.solana.walletAccount(1).index).toBe(1);
      expect(config.blockchain.tron.walletAccount(2).index).toBe(2);
      expect(config.blockchain.cardano.walletAccount(5).index).toBe(5);
      expect(config.blockchain.internetComputer.walletAccount(6).index).toBe(6);
    });

    it('builds environment-aware public API URLs', () => {
      const loc = Object.assign(new Configuration(), { environment: Environment.LOC, port: 3000 });
      expect(loc.url()).toBe('http://localhost:3000/v1');
      expect(loc.url('2')).toBe('http://localhost:3000/v2');

      const prd = Object.assign(new Configuration(), { environment: Environment.PRD, port: 3000 });
      expect(prd.url()).toBe('https://api.dfx.swiss/v1');

      const dev = Object.assign(new Configuration(), { environment: Environment.DEV, port: 3000 });
      expect(dev.url()).toBe('https://dev.api.dfx.swiss/v1');
    });

    it('exposes exchange and EVM wallet getters including withdraw-key maps', () => {
      const previous = {
        KRAKEN_WITHDRAW_KEYS: process.env.KRAKEN_WITHDRAW_KEYS,
        BINANCE_WITHDRAW_KEYS: process.env.BINANCE_WITHDRAW_KEYS,
        P2B_WITHDRAW_KEYS: process.env.P2B_WITHDRAW_KEYS,
        XT_WITHDRAW_KEYS: process.env.XT_WITHDRAW_KEYS,
        MEXC_WITHDRAW_KEYS: process.env.MEXC_WITHDRAW_KEYS,
        EVM_WALLETS: process.env.EVM_WALLETS,
        KRAKEN_KEY: process.env.KRAKEN_KEY,
        BINANCE_KEY: process.env.BINANCE_KEY,
        P2B_KEY: process.env.P2B_KEY,
        XT_KEY: process.env.XT_KEY,
        MEXC_KEY: process.env.MEXC_KEY,
      };

      process.env.KRAKEN_WITHDRAW_KEYS = 'a:1,b:2';
      process.env.BINANCE_WITHDRAW_KEYS = 'c:3';
      process.env.P2B_WITHDRAW_KEYS = 'd:4';
      process.env.XT_WITHDRAW_KEYS = 'e:5';
      process.env.MEXC_WITHDRAW_KEYS = 'f:6';
      process.env.EVM_WALLETS = 'wallet:0xabc';
      process.env.KRAKEN_KEY = 'kk';
      process.env.BINANCE_KEY = 'bk';
      process.env.P2B_KEY = 'pk';
      process.env.XT_KEY = 'xk';
      process.env.MEXC_KEY = 'mk';

      try {
        const config = GetConfig();
        expect(config.kraken.apiKey).toBe('kk');
        expect(config.kraken.withdrawKeys.get('a')).toBe('1');
        expect(config.binance.apiKey).toBe('bk');
        expect(config.binance.quoteJsonNumbers).toBe(false);
        expect(config.p2b.apiKey).toBe('pk');
        expect(config.xt.apiKey).toBe('xk');
        expect(config.mexc.apiKey).toBe('mk');
        expect(config.mexc.options).toEqual({ recvWindow: config.mexcRecvWindow });
        expect(config.evmWallets.get('wallet')).toBe('0xabc');

        // empty withdraw keys path
        delete process.env.EVM_WALLETS;
        expect(GetConfig().evmWallets.size).toBe(0);
      } finally {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    });

    it('parses Azure BlobEndpoint from the connection string', () => {
      const previous = process.env.AZURE_STORAGE_CONNECTION_STRING;
      process.env.AZURE_STORAGE_CONNECTION_STRING =
        'DefaultEndpointsProtocol=https;AccountName=x;BlobEndpoint=https://x.blob.core.windows.net/;AccountKey=y';

      try {
        const config = GetConfig();
        expect(config.azure.storage.url).toBe('https://x.blob.core.windows.net/');
      } finally {
        if (previous === undefined) delete process.env.AZURE_STORAGE_CONNECTION_STRING;
        else process.env.AZURE_STORAGE_CONNECTION_STRING = previous;
      }
    });

    it('returns raw storage knobs in LOC without validation', () => {
      const previousEnv = process.env.ENVIRONMENT;
      const previousWrite = process.env.STORAGE_WRITE_MODE;
      const previousRead = process.env.STORAGE_READ_SOURCE;
      process.env.ENVIRONMENT = Environment.LOC;
      process.env.STORAGE_WRITE_MODE = 'not-a-mode';
      process.env.STORAGE_READ_SOURCE = 'also-bad';

      try {
        const config = GetConfig();
        expect(config.storage).toEqual({ writeMode: 'not-a-mode', readSource: 'also-bad' });
      } finally {
        if (previousEnv === undefined) delete process.env.ENVIRONMENT;
        else process.env.ENVIRONMENT = previousEnv;
        if (previousWrite === undefined) delete process.env.STORAGE_WRITE_MODE;
        else process.env.STORAGE_WRITE_MODE = previousWrite;
        if (previousRead === undefined) delete process.env.STORAGE_READ_SOURCE;
        else process.env.STORAGE_READ_SOURCE = previousRead;
      }
    });

    it('validates storage write/read modes outside LOC', () => {
      const previousEnv = process.env.ENVIRONMENT;
      const previousWrite = process.env.STORAGE_WRITE_MODE;
      const previousRead = process.env.STORAGE_READ_SOURCE;
      process.env.ENVIRONMENT = Environment.DEV;

      try {
        process.env.STORAGE_WRITE_MODE = 'dual';
        process.env.STORAGE_READ_SOURCE = 's3';
        expect(GetConfig().storage).toEqual({ writeMode: 'dual', readSource: 's3' });

        process.env.STORAGE_WRITE_MODE = 'nope';
        process.env.STORAGE_READ_SOURCE = 's3';
        expect(() => GetConfig().storage).toThrow(/STORAGE_WRITE_MODE/);

        process.env.STORAGE_WRITE_MODE = 's3';
        process.env.STORAGE_READ_SOURCE = 'nope';
        expect(() => GetConfig().storage).toThrow(/STORAGE_READ_SOURCE/);

        process.env.STORAGE_WRITE_MODE = 'azure';
        process.env.STORAGE_READ_SOURCE = 's3';
        expect(() => GetConfig().storage).toThrow(/Invalid storage config/);
        expect(() => assertValidStorageCombo('s3', 'azure')).toThrow(/Invalid storage config/);
      } finally {
        if (previousEnv === undefined) delete process.env.ENVIRONMENT;
        else process.env.ENVIRONMENT = previousEnv;
        if (previousWrite === undefined) delete process.env.STORAGE_WRITE_MODE;
        else process.env.STORAGE_WRITE_MODE = previousWrite;
        if (previousRead === undefined) delete process.env.STORAGE_READ_SOURCE;
        else process.env.STORAGE_READ_SOURCE = previousRead;
      }
    });

    it('reads the lightning certificate from a file path when configured', () => {
      const previousPath = process.env.LIGHTNING_API_CERTIFICATE_PATH;
      const previousCert = process.env.LIGHTNING_API_CERTIFICATE;
      const certPath = join(tmpdir(), `lnd-cert-${Date.now()}.pem`);
      writeFileSync(certPath, 'CERT-FROM-FILE');

      try {
        process.env.LIGHTNING_API_CERTIFICATE_PATH = certPath;
        delete process.env.LIGHTNING_API_CERTIFICATE;
        expect(GetConfig().blockchain.lightning.certificate).toBe('CERT-FROM-FILE');
      } finally {
        unlinkSync(certPath);
        if (previousPath === undefined) delete process.env.LIGHTNING_API_CERTIFICATE_PATH;
        else process.env.LIGHTNING_API_CERTIFICATE_PATH = previousPath;
        if (previousCert === undefined) delete process.env.LIGHTNING_API_CERTIFICATE;
        else process.env.LIGHTNING_API_CERTIFICATE = previousCert;
      }
    });

    it('falls back to the env lightning certificate when no path is set', () => {
      const previousPath = process.env.LIGHTNING_API_CERTIFICATE_PATH;
      const previousCert = process.env.LIGHTNING_API_CERTIFICATE;
      delete process.env.LIGHTNING_API_CERTIFICATE_PATH;
      process.env.LIGHTNING_API_CERTIFICATE = 'line-a<br>line-b';

      try {
        expect(GetConfig().blockchain.lightning.certificate).toBe('line-a\nline-b');
      } finally {
        if (previousPath === undefined) delete process.env.LIGHTNING_API_CERTIFICATE_PATH;
        else process.env.LIGHTNING_API_CERTIFICATE_PATH = previousPath;
        if (previousCert === undefined) delete process.env.LIGHTNING_API_CERTIFICATE;
        else process.env.LIGHTNING_API_CERTIFICATE = previousCert;
      }
    });

    it('includes RealUnit wallet config when REALUNIT_MAIL_USER is set', () => {
      const previousUser = process.env.REALUNIT_MAIL_USER;
      const previousPass = process.env.REALUNIT_MAIL_PASS;
      process.env.REALUNIT_MAIL_USER = 'realunit@example.com';
      process.env.REALUNIT_MAIL_PASS = 'secret';

      try {
        const config = GetConfig();
        expect(config.mail.wallet.RealUnit).toEqual(
          expect.objectContaining({
            template: 'realunit',
            forcedLang: 'de',
            centralizedWelcome: true,
            isPreferred: true,
            fromAddress: 'realunit@example.com',
          }),
        );
      } finally {
        if (previousUser === undefined) delete process.env.REALUNIT_MAIL_USER;
        else process.env.REALUNIT_MAIL_USER = previousUser;
        if (previousPass === undefined) delete process.env.REALUNIT_MAIL_PASS;
        else process.env.REALUNIT_MAIL_PASS = previousPass;
      }
    });

    it('disables SQL SSL when SQL_SSL is false', () => {
      const previous = process.env.SQL_SSL;
      process.env.SQL_SSL = 'false';
      try {
        expect((GetConfig().database as PostgresConnectionOptions).ssl).toBe(false);
      } finally {
        if (previous === undefined) delete process.env.SQL_SSL;
        else process.env.SQL_SSL = previous;
      }
    });

    it('requires a positive REALUNIT_W2W_GAS_LOW_BALANCE_THRESHOLD at construction', () => {
      const previous = process.env.REALUNIT_W2W_GAS_LOW_BALANCE_THRESHOLD;

      try {
        delete process.env.REALUNIT_W2W_GAS_LOW_BALANCE_THRESHOLD;
        expect(() => GetConfig()).toThrow(/Missing REALUNIT_W2W_GAS_LOW_BALANCE_THRESHOLD/);

        process.env.REALUNIT_W2W_GAS_LOW_BALANCE_THRESHOLD = '0';
        expect(() => GetConfig()).toThrow(/Invalid REALUNIT_W2W_GAS_LOW_BALANCE_THRESHOLD/);

        process.env.REALUNIT_W2W_GAS_LOW_BALANCE_THRESHOLD = 'not-a-number';
        expect(() => GetConfig()).toThrow(/Invalid REALUNIT_W2W_GAS_LOW_BALANCE_THRESHOLD/);

        process.env.REALUNIT_W2W_GAS_LOW_BALANCE_THRESHOLD = '0.05';
        expect(GetConfig().blockchain.realunit.w2wGasLowBalanceThreshold).toBe(0.05);
      } finally {
        if (previous === undefined) delete process.env.REALUNIT_W2W_GAS_LOW_BALANCE_THRESHOLD;
        else process.env.REALUNIT_W2W_GAS_LOW_BALANCE_THRESHOLD = previous;
      }
    });
  });

  describe('fileDownloadConfig callbacks', () => {
    const config = new Configuration();
    const user = (overrides: Record<string, unknown> = {}): UserData =>
      ({
        id: 42,
        firstname: 'Ada',
        accountType: AccountType.PERSONAL,
        accountOpenerAuthorization: undefined,
        identificationType: KycIdentificationType.VIDEO_ID,
        amlAccountType: 'natural person',
        kycSteps: [],
        ...overrides,
      }) as unknown as UserData;

    const file = (overrides: Partial<KycFileBlob> & { name: string }): KycFileBlob =>
      ({
        contentType: ContentType.PDF,
        category: FileCategory.USER,
        url: 'https://files.dfx.swiss/kyc/user/42/x.pdf',
        path: overrides.name,
        ...overrides,
      }) as unknown as KycFileBlob;

    function entry(id: number) {
      const found = config.fileDownloadConfig.find((c) => c.id === id);
      if (!found) throw new Error(`missing fileDownloadConfig id ${id}`);
      return found;
    }

    it('exercises every prefixes / name / filter / ignore / sort / handleFileNotFound callback', () => {
      const ud = user();

      // id 1 Deckblatt
      expect(entry(1).files[0].prefixes!(ud)).toEqual([`user/42/UserNotes`]);
      expect(entry(1).files[0].filter!(file({ name: 'GwGFileDeckblatt.pdf' }), ud)).toBe(true);
      expect(entry(1).files[0].filter!(file({ name: 'other.pdf' }), ud)).toBe(false);

      // id 2 Identifikationsdokument
      expect(entry(2).files[0].prefixes!(ud)).toEqual([
        'user/42/Identification',
        'spider/42/online-identification',
        'spider/42/video_identification',
      ]);
      const named = entry(2).files[1];
      expect(named.prefixes!(ud)).toEqual(['user/42/Identification']);
      expect(named.name!(file({ name: 'user/42/Identification/doc.png' }))).toBe('doc');
      expect(named.name!(file({ name: 'no-extension' }))).toBe('no-extension');
      // ?? 'IdentDoc' only fires when pop() yields undefined (not an empty string basename).
      expect(named.name!({ name: { split: () => ({ pop: () => undefined }) } } as unknown as KycFileBlob)).toBe(
        'IdentDoc',
      );
      expect(named.handleFileNotFound!(new JSZip(), ud)).toBe(true);

      const completedIdent = {
        name: KycStepName.IDENT,
        isCompleted: true,
        transactionId: 'tx-ident-1',
        id: 9,
      };
      const olderIdent = {
        name: KycStepName.IDENT,
        isCompleted: true,
        transactionId: 'tx-old',
        id: 1,
      };
      const withIdent = user({ kycSteps: [olderIdent, completedIdent] });
      expect(named.filter!(file({ name: 'path/tx-ident-1/x.png' }), withIdent)).toBe(true);
      expect(named.filter!(file({ name: 'path/tx-old/x.png' }), withIdent)).toBe(false);
      expect(named.filter!(file({ name: 'path/tx-ident-1/x.png' }), user({ kycSteps: [] }))).toBe(false);

      // id 3 Banktransaktion oder Videoident Tonspur
      const audio = entry(3).files[0];
      expect(audio.name!(file({ name: 'bankTransactionVerify.pdf' }))).toBe('Banktransaktion');
      expect(audio.name!(file({ name: 'other.mp3' }))).toBe('VideoIdentTonspur');

      const videoUser = user({ identificationType: KycIdentificationType.VIDEO_ID });
      expect(audio.prefixes!(videoUser)).toEqual(['user/42/Identification', 'spider/42/video_identification']);
      expect(audio.filter!(file({ name: 'clip.mp3', contentType: ContentType.MP3 }), videoUser)).toBe(true);
      expect(audio.filter!(file({ name: 'clip.mp4', contentType: ContentType.MP4 }), videoUser)).toBe(true);

      const onlineUser = user({ identificationType: KycIdentificationType.ONLINE_ID });
      expect(audio.prefixes!(onlineUser)).toEqual(['user/42/UserNotes']);
      expect(
        audio.filter!(file({ name: 'bankTransactionVerify-x.pdf', contentType: ContentType.PDF }), onlineUser),
      ).toBe(true);
      expect(audio.filter!(file({ name: 'other.pdf', contentType: ContentType.PDF }), onlineUser)).toBe(false);

      const manualUser = user({ identificationType: KycIdentificationType.MANUAL });
      expect(audio.prefixes!(manualUser)).toEqual([]);
      const zip = new JSZip();
      expect(audio.handleFileNotFound!(zip, manualUser)).toBe(zip);
      expect(audio.handleFileNotFound!(zip, videoUser)).toBe(false);

      // ids 4-6 simple UserNotes filters
      for (const [id, needle] of [
        [4, 'Identifizierungsformular'],
        [5, 'Kundenprofil'],
        [6, 'Risikoprofil'],
      ] as const) {
        expect(entry(id).files[0].prefixes!(ud)).toEqual(['user/42/UserNotes']);
        expect(entry(id).files[0].filter!(file({ name: `${needle}.pdf` }), ud)).toBe(true);
        expect(entry(id).files[0].filter!(file({ name: 'nope.pdf' }), ud)).toBe(false);
      }

      // id 7 Formular A oder K
      const form = entry(7).files[0];
      expect(form.name!(file({ name: 'FormularA.pdf' }))).toBe('FormularA');
      expect(form.name!(file({ name: 'FormularK.pdf' }))).toBe('FormularK');
      expect(form.prefixes!(ud)).toEqual(['user/42/UserNotes']);
      expect(form.filter!(file({ name: 'FormularA.pdf' }), user({ amlAccountType: 'natural person' }))).toBe(true);
      expect(form.filter!(file({ name: 'FormularA.pdf' }), user({ amlAccountType: 'Sitzgesellschaft' }))).toBe(true);
      expect(
        form.filter!(file({ name: 'FormularK.pdf' }), user({ amlAccountType: 'operativ tätige Gesellschaft' })),
      ).toBe(true);
      expect(form.filter!(file({ name: 'FormularK.pdf' }), user({ amlAccountType: 'Verein' }))).toBe(true);
      expect(form.filter!(file({ name: 'FormularA.pdf' }), user({ amlAccountType: 'Verein' }))).toBe(false);

      // id 8 Onboardingdokument
      const onboarding = entry(8).files[0];
      expect(onboarding.name!(file({ name: 'any.pdf' }))).toBe('Onboarding');
      expect(onboarding.prefixes!(ud)).toEqual(['spider/42/user-added-document', 'user/42/UserNotes']);
      expect(onboarding.filter!(file({ name: 'My-Onboarding-Doc.pdf' }), ud)).toBe(true);
      expect(onboarding.filter!(file({ name: 'other.pdf' }), ud)).toBe(false);

      // id 9 Blockchain Check
      expect(entry(9).files[0].prefixes!(ud)).toEqual(['user/42/UserNotes']);
      expect(entry(9).files[0].filter!(file({ name: 'blockchainAddressAnalyse.pdf' }), ud)).toBe(true);

      // id 10 Wohnsitzadresse
      expect(entry(10).ignore!(user({ accountType: AccountType.ORGANIZATION }))).toBe(true);
      expect(entry(10).ignore!(user({ accountType: AccountType.PERSONAL }))).toBe(false);
      const address = entry(10).files[0];
      expect(address.name!(file({ name: 'any.pdf' }))).toBe('Postversand');
      expect(address.prefixes!(ud)).toEqual(['spider/42/user-added-document', 'user/42/UserNotes']);
      expect(address.filter!(file({ name: 'postversand.pdf', category: FileCategory.USER }), ud)).toBe(true);
      expect(address.filter!(file({ name: 'Ada-passport.pdf', category: FileCategory.SPIDER }), ud)).toBe(true);
      expect(address.filter!(file({ name: 'other.pdf', category: FileCategory.USER }), ud)).toBe(false);

      // id 11 Handelsregisterauszug
      expect(entry(11).ignore!(user({ accountType: AccountType.PERSONAL }))).toBe(true);
      expect(entry(11).ignore!(user({ accountType: AccountType.ORGANIZATION }))).toBe(false);
      expect(entry(11).files[0].prefixes!(ud)).toEqual(['user/42/CommercialRegister']);
      const hrUrl = 'https://files.dfx.swiss/kyc/user/42/CommercialRegister/hr.pdf';
      const hrFile = file({ name: 'hr.pdf', url: hrUrl });
      // COMMERCIAL_REGISTER
      expect(
        entry(11).files[0].filter!(
          hrFile,
          user({
            kycSteps: [
              {
                name: KycStepName.COMMERCIAL_REGISTER,
                isCompleted: true,
                result: hrUrl,
              },
            ],
          }),
        ),
      ).toBe(true);
      // LEGAL_ENTITY
      expect(
        entry(11).files[0].filter!(
          hrFile,
          user({
            kycSteps: [
              {
                name: KycStepName.LEGAL_ENTITY,
                isCompleted: true,
                getResult: () => ({ url: hrUrl, legalEntity: 'AG' }),
              },
            ],
          }),
        ),
      ).toBe(true);
      // SOLE_PROPRIETORSHIP_CONFIRMATION
      expect(
        entry(11).files[0].filter!(
          hrFile,
          user({
            kycSteps: [
              {
                name: KycStepName.SOLE_PROPRIETORSHIP_CONFIRMATION,
                isCompleted: true,
                getResult: () => ({ url: hrUrl }),
              },
            ],
          }),
        ),
      ).toBe(true);
      expect(entry(11).files[0].filter!(hrFile, user({ kycSteps: [] }))).toBe(false);

      // id 12 Vollmacht
      expect(entry(12).ignore!(user({ accountOpenerAuthorization: 'Vollmacht' }))).toBe(false);
      expect(entry(12).ignore!(user({ accountOpenerAuthorization: 'other' }))).toBe(true);
      expect(entry(12).files[0].prefixes!(ud)).toEqual(['user/42/Authority']);
      const authUrl = 'https://files.dfx.swiss/kyc/user/42/Authority/v.pdf';
      expect(
        entry(12).files[0].filter!(
          file({ name: 'v.pdf', url: authUrl }),
          user({
            kycSteps: [{ name: KycStepName.AUTHORITY, isCompleted: true, result: authUrl }],
          }),
        ),
      ).toBe(true);
      expect(
        entry(12).files[0].filter!(
          file({ name: 'v.pdf', url: authUrl }),
          user({ kycSteps: [{ name: KycStepName.AUTHORITY, isCompleted: false, result: authUrl }] }),
        ),
      ).toBe(false);

      // id 13 Transaktionsliste
      expect(entry(13).files[0].prefixes!(ud)).toEqual(['user/42/UserNotes']);
      expect(entry(13).files[0].filter!(file({ name: 'x-TxAudit2026.pdf' }), ud)).toBe(true);
      expect(entry(13).files[0].filter!(file({ name: 'other.pdf' }), ud)).toBe(false);

      // id 14 Name Check
      expect(entry(14).files[0].prefixes!(ud)).toEqual(['user/42/UserNotes']);
      expect(entry(14).files[0].filter!(file({ name: 'x-NameCheck.pdf' }), ud)).toBe(true);
      expect(entry(14).files[1].name!(file({ name: 'any.pdf' }))).toBe('Dilisense Screening Report');
      expect(entry(14).files[1].prefixes!(ud)).toEqual(['user/42/NameCheck']);

      // id 15 Travel Rule sort + filter
      const travel = entry(15).files[0];
      expect(travel.prefixes!(ud)).toEqual(['user/42/UserNotes']);
      expect(travel.filter!(file({ name: 'a-AddressSignature.pdf' }), ud)).toBe(true);
      const earlier = file({ name: 'a-AddressSignature.pdf' });
      const later = file({ name: 'b-AddressSignature.pdf' });
      expect(travel.sort!(earlier, later)).toBe(earlier);
      expect(travel.sort!(later, earlier)).toBe(earlier);

      // id 16 TMER
      const tmer = entry(16).files[0];
      expect(tmer.name!(file({ name: 'user/42/UserNotes/foo-TMER-1.pdf' }))).toBe('foo-TMER-1');
      expect(tmer.name!({ name: { split: () => ({ pop: () => undefined }) } } as unknown as KycFileBlob)).toBe('TMER');
      expect(tmer.prefixes!(ud)).toEqual(['user/42/UserNotes']);
      expect(tmer.filter!(file({ name: 'x-TMER-y.pdf' }), ud)).toBe(true);
      expect(tmer.handleFileNotFound!(new JSZip(), ud)).toBe(true);
    });
  });
});
