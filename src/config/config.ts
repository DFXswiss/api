import { NetworkName } from '@defichain/jellyfish-network';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { Injectable, Optional } from '@nestjs/common';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Exchange } from 'ccxt';
import JSZip from 'jszip';
import { I18nOptions } from 'nestjs-i18n';
import { join } from 'path';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { WalletAccount } from 'src/integration/blockchain/shared/evm/domain/wallet-account';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Process } from 'src/shared/services/process.service';
import { PaymentStandard } from 'src/subdomains/core/payment-link/enums';
import { KycFileBlob } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { ContentType } from 'src/subdomains/generic/kyc/enums/content-type.enum';
import { FileCategory } from 'src/subdomains/generic/kyc/enums/file-category.enum';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { KycIdentificationType } from 'src/subdomains/generic/user/models/user-data/kyc-identification-type.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { MailOptions } from 'src/subdomains/supporting/notification/services/mail.service';

export enum Environment {
  LOC = 'loc',
  DEV = 'dev',
  PRD = 'prd',
}

export type ExchangeConfig = Partial<Exchange> & { withdrawKeys?: Map<string, string> };

export type Version = '1' | '2';

export function GetConfig(): Configuration {
  return new Configuration();
}

export class Configuration {
  port = process.env.PORT ?? 3000;
  environment = process.env.ENVIRONMENT as Environment;
  network = process.env.NETWORK as NetworkName;

  defaultVersion: Version = '1';
  kycVersion: Version = '2';
  defaultVersionString = `v${this.defaultVersion}`;
  transactionRefundExpirySeconds = 30;
  refRewardManualCheckLimit = 3000; // EUR
  manualPriceStepSourceName = 'DFX'; // source name for priceStep if price is set manually in buyCrypto
  txRequestWaitingExpiryDays = 7;
  exchangeRateFromLiquidityOrder = ['FPS', 'nDEPS'];

  defaults = {
    currency: 'EUR',
    language: 'EN',

    specific: {
      CH: { language: 'DE', currency: 'CHF' },
      LI: { language: 'DE', currency: 'CHF' },
      DE: { language: 'DE' },
      AT: { language: 'DE' },
      IT: { language: 'IT' },
      FR: { language: 'FR' },
    },

    forCountry: (country?: string): { currency: string; language: string } => {
      const specific = this.defaults.specific[country];
      return {
        currency: specific?.currency ?? this.defaults.currency,
        language: specific?.language ?? this.defaults.language,
      };
    },
  };

  prefixes = {
    issueUidPrefix: 'I',
    quoteUidPrefix: 'Q',
    transactionUidPrefix: 'T',
    kycFileUidPrefix: 'F',
    paymentLinkUidPrefix: 'pl',
    paymentLinkPaymentUidPrefix: 'plp',
    paymentQuoteUidPrefix: 'plq',
  };

  moderators = {
    Wendel: '019-957',
  };

  loginCountries = {
    '1': ['CH'],
  };

  liquidityManagement = {
    bankMinBalance: 100,
    fiatOutput: {
      batchAmountLimit: 9500,
    },
  };

  defaultVolumeDecimal = 2;
  defaultPercentageDecimal = 2;

  apiKeyVersionCT = '1'; // single digit hex number
  azureIpSubstring = '169.254';

  amlCheckLastNameCheckValidity = 90; // days
  maxBlockchainFee = 50; // CHF
  blockchainFeeBuffer = 1.2;
  networkStartFee = 0.5; // CHF
  networkStartBalanceLimit = 0.00001;
  networkStartBlockchains = [
    Blockchain.BASE,
    Blockchain.ARBITRUM,
    Blockchain.OPTIMISM,
    Blockchain.POLYGON,
    Blockchain.BINANCE_SMART_CHAIN,
  ];

  tradingLimits = {
    monthlyDefaultWoKyc: 1000, // CHF
    weeklyAmlRule: 5000, // CHF
    monthlyDefault: 500000, // CHF
    yearlyDefault: 1000000000, // CHF
    yearlyWithoutKyc: 50000, // CHF
    cardDefault: 4000, // CHF
  };

  social = {
    telegram: 'https://t.me/DFXswiss',
    linkedin: 'https://www.linkedin.com/company/dfxswiss/',
    instagram: 'https://www.instagram.com/dfx.swiss/',
    twitter: 'https://twitter.com/DFX_Swiss',
    github: 'https://github.com/DFXswiss/api#dfx-api',
  };

  bitcoinAddressFormat = '([13]|bc1)[a-zA-HJ-NP-Z0-9]{25,62}';
  lightningAddressFormat = '(LNURL|LNDHUB)[A-Z0-9]{25,250}|LNNID[A-Z0-9]{66}';
  moneroAddressFormat = '[48][0-9AB][1-9A-HJ-NP-Za-km-z]{93}';
  ethereumAddressFormat = '0x\\w{40}';
  liquidAddressFormat = '(VTp|VJL)[a-zA-HJ-NP-Z0-9]{77}';
  arweaveAddressFormat = '[\\w\\-]{43}';
  cardanoAddressFormat = 'stake[a-z0-9]{54}';
  defichainAddressFormat =
    this.environment === Environment.PRD ? '8\\w{33}|d\\w{33}|d\\w{41}' : '[78]\\w{33}|[td]\\w{33}|[td]\\w{41}';
  railgunAddressFormat = '0zk[a-z0-9]{1,124}';
  solanaAddressFormat = '[1-9A-HJ-NP-Za-km-z]{32,44}';

  allAddressFormat = `${this.bitcoinAddressFormat}|${this.lightningAddressFormat}|${this.moneroAddressFormat}|${this.ethereumAddressFormat}|${this.liquidAddressFormat}|${this.arweaveAddressFormat}|${this.cardanoAddressFormat}|${this.defichainAddressFormat}|${this.railgunAddressFormat}|${this.solanaAddressFormat}`;

  masterKeySignatureFormat = '[0-9a-fA-F]{8}\\b-[0-9a-fA-F]{4}\\b-[0-9a-fA-F]{4}\\b-[0-9a-fA-F]{4}\\b-[0-9a-fA-F]{12}';
  hashSignatureFormat = '[A-Fa-f0-9]{64}';
  bitcoinSignatureFormat = '.{87}=';
  lightningSignatureFormat = '[a-z0-9]{104}';
  lightningCustodialSignatureFormat = '[a-z0-9]{140,146}';
  moneroSignatureFormat = 'SigV\\d[0-9a-zA-Z]{88}';
  ethereumSignatureFormat = '(0x)?[a-f0-9]{130}';
  arweaveSignatureFormat = '[\\w\\-]{683}';
  cardanoSignatureFormat = '[a-f0-9]{582}';
  railgunSignatureFormat = '[a-f0-9]{128}';
  solanaSignatureFormat = '[1-9A-HJ-NP-Za-km-z]{88}';

  allSignatureFormat = `${this.masterKeySignatureFormat}|${this.hashSignatureFormat}|${this.bitcoinSignatureFormat}|${this.lightningSignatureFormat}|${this.lightningCustodialSignatureFormat}|${this.moneroSignatureFormat}|${this.ethereumSignatureFormat}|${this.arweaveSignatureFormat}|${this.cardanoSignatureFormat}|${this.railgunSignatureFormat}|${this.solanaSignatureFormat}`;

  arweaveKeyFormat = '[\\w\\-]{683}';
  cardanoKeyFormat = '[a-f0-9]{84}';

  allKeyFormat = `${this.arweaveKeyFormat}|${this.cardanoKeyFormat}`;

  formats = {
    address: new RegExp(`^(${this.allAddressFormat})$`),
    signature: new RegExp(`^(${this.allSignatureFormat})$`),
    key: new RegExp(`^(${this.allKeyFormat})$`),
    ref: /^(\w{1,3}-\w{1,3})$/,
    bankUsage: /[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/,
  };

  database: TypeOrmModuleOptions = {
    type: 'mssql',
    host: process.env.SQL_HOST,
    port: Number.parseInt(process.env.SQL_PORT),
    username: process.env.SQL_USERNAME,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB,
    entities: ['dist/**/*.entity{.ts,.js}'],
    autoLoadEntities: true,
    synchronize: process.env.SQL_SYNCHRONIZE === 'true',
    migrationsRun: process.env.SQL_MIGRATE === 'true',
    migrations: ['migration/*.js'],
    connectionTimeout: 30000,
    requestTimeout: 60000,
    pool: {
      min: +(process.env.SQL_POOL_MIN ?? 5),
      max: +(process.env.SQL_POOL_MAX ?? 10),
      idleTimeoutMillis: +(process.env.SQL_POOL_IDLE_TIMEOUT ?? 30000),
    },
  };

  i18n: I18nOptions = {
    fallbackLanguage: this.defaults.language.toLowerCase(),
    loaderOptions: {
      path: join(process.cwd(), 'src/shared/i18n/'),
      watch: true,
    },
    resolvers: [{ resolve: () => this.i18n.fallbackLanguage }],
  };

  auth = {
    jwt: {
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: process.env.JWT_EXPIRES_IN ?? '2d',
      },
    },
    company: {
      signOptions: {
        expiresIn: process.env.JWT_EXPIRES_IN_COMPANY ?? '10m',
      },
    },
    challenge: {
      expiresIn: +(process.env.CHALLENGE_EXPIRES_IN ?? 10), // sec
    },
    mailLoginExpiresIn: +(process.env.MAIL_LOGIN_EXPIRES_IN ?? 10), // min
    signMessage:
      'By_signing_this_message,_you_confirm_that_you_are_the_sole_owner_of_the_provided_DeFiChain_address_and_are_in_possession_of_its_private_key._Your_ID:_',
    signMessageGeneral:
      'By_signing_this_message,_you_confirm_that_you_are_the_sole_owner_of_the_provided_Blockchain_address._Your_ID:_',
  };

  kyc = {
    gatewayHost: process.env.KYC_GATEWAY_HOST,
    auto: { customer: process.env.KYC_CUSTOMER_AUTO, apiKey: process.env.KYC_API_KEY_AUTO },
    video: { customer: process.env.KYC_CUSTOMER_VIDEO, apiKey: process.env.KYC_API_KEY_VIDEO },
    transactionPrefix: process.env.KYC_TRANSACTION_PREFIX,
    identFailAfterDays: 90,
    allowedWebhookIps: process.env.KYC_WEBHOOK_IPS?.split(','),
    reminderAfterDays: 2,
    appToken: process.env.KYC_APP_TOKEN,
    secretKey: process.env.KYC_SECRET_KEY,
    webhookKey: process.env.KYC_WEBHOOK_KEY,
    residencePermitCountries: ['RU'],
    maxIdentTries: 7,
  };

  fileDownloadConfig: {
    id: number;
    name: string;
    ignore?: (userData: UserData) => boolean;
    files: {
      name?: (file: KycFileBlob) => string;
      prefixes: (userData: UserData) => string[];
      fileTypes?: ContentType[];
      filter?: (file: KycFileBlob, userData: UserData) => boolean;
      sort?: (a: KycFileBlob, b: KycFileBlob) => KycFileBlob;
      handleFileNotFound?: (zip: JSZip, userData: UserData) => any | false;
    }[];
  }[] = [
    {
      id: 1,
      name: 'Deckblatt',
      files: [
        {
          prefixes: (userData: UserData) => [`user/${userData.id}/UserNotes`],
          fileTypes: [ContentType.PDF],
          filter: (file: KycFileBlob) => file.name.includes('GwGFileDeckblatt'),
        },
      ],
    },
    {
      id: 2,
      name: 'Identifikationsdokument',
      files: [
        {
          prefixes: (userData: UserData) => [
            `user/${userData.id}/Identification`,
            `spider/${userData.id}/online-identification`,
            `spider/${userData.id}/video_identification`,
          ],
          fileTypes: [ContentType.PDF],
        },
      ],
    },
    {
      id: 3,
      name: 'Banktransaktion oder Videoident Tonspur',
      files: [
        {
          name: (file: KycFileBlob) =>
            file.name.includes('bankTransactionVerify') ? 'Banktransaktion' : 'VideoIdentTonspur',
          prefixes: (userData: UserData) => {
            switch (userData.identificationType) {
              case KycIdentificationType.VIDEO_ID:
                return [`user/${userData.id}/Identification`, `spider/${userData.id}/video_identification`];
              case KycIdentificationType.ONLINE_ID:
                return [`user/${userData.id}/UserNotes`];
              default:
                return [];
            }
          },
          filter: (file: KycFileBlob, userData: UserData) =>
            (userData.identificationType === KycIdentificationType.VIDEO_ID &&
              (file.contentType.startsWith(ContentType.MP3) || file.contentType.startsWith(ContentType.MP4))) ||
            (userData.identificationType === KycIdentificationType.ONLINE_ID &&
              file.name.includes('bankTransactionVerify') &&
              file.contentType.startsWith(ContentType.PDF)),
          handleFileNotFound: (zip: JSZip, userData: UserData) =>
            userData.identificationType === KycIdentificationType.MANUAL
              ? zip.file('03_nicht_benötigt_aufgrund_manueller_identifikation.txt', '')
              : false,
        },
      ],
    },
    {
      id: 4,
      name: 'Identifizierungsformular',
      files: [
        {
          prefixes: (userData: UserData) => [`user/${userData.id}/UserNotes`],
          fileTypes: [ContentType.PDF],
          filter: (file: KycFileBlob) => file.name.includes('Identifizierungsformular'),
        },
      ],
    },
    {
      id: 5,
      name: 'Kundenprofil',
      files: [
        {
          prefixes: (userData: UserData) => [`user/${userData.id}/UserNotes`],
          fileTypes: [ContentType.PDF],
          filter: (file: KycFileBlob) => file.name.includes('Kundenprofil'),
        },
      ],
    },
    {
      id: 6,
      name: 'Risikoprofil',
      files: [
        {
          prefixes: (userData: UserData) => [`user/${userData.id}/UserNotes`],
          fileTypes: [ContentType.PDF],
          filter: (file: KycFileBlob) => file.name.includes('Risikoprofil'),
        },
      ],
    },
    {
      id: 7,
      name: 'Formular A oder K',
      files: [
        {
          name: (file: KycFileBlob) => (file.name.includes('FormularA') ? 'FormularA' : 'FormularK'),
          prefixes: (userData: UserData) => [`user/${userData.id}/UserNotes`],
          fileTypes: [ContentType.PDF],
          filter: (file: KycFileBlob, userData: UserData) =>
            (['natural person', 'Sitzgesellschaft'].includes(userData.amlAccountType) &&
              file.name.includes('FormularA')) ||
            (['operativ tätige Gesellschaft', 'Verein'].includes(userData.amlAccountType) &&
              file.name.includes('FormularK')),
        },
      ],
    },
    {
      id: 8,
      name: 'Onboardingdokument',
      files: [
        {
          name: () => 'Onboarding',
          prefixes: (userData: UserData) => [
            `spider/${userData.id}/user-added-document`,
            `user/${userData.id}/UserNotes`,
          ],
          fileTypes: [ContentType.PDF],
          filter: (file: KycFileBlob) => file.name.toLowerCase().includes('onboarding'),
        },
      ],
    },
    {
      id: 9,
      name: 'Blockchain Check',
      files: [
        {
          prefixes: (userData: UserData) => [`user/${userData.id}/UserNotes`],
          fileTypes: [ContentType.PDF],
          filter: (file: KycFileBlob) => file.name.includes('blockchainAddressAnalyse'),
        },
      ],
    },
    {
      id: 10,
      name: 'Überprüfung der Wohnsitzadresse',
      ignore: (userData: UserData) => userData.accountType === AccountType.ORGANIZATION,
      files: [
        {
          name: () => 'Postversand',
          prefixes: (userData: UserData) => [
            `spider/${userData.id}/user-added-document`,
            `user/${userData.id}/UserNotes`,
          ],
          fileTypes: [ContentType.PDF],
          filter: (file: KycFileBlob, userData: UserData) =>
            (file.category === FileCategory.USER && file.name.includes('postversand')) ||
            (file.category === FileCategory.SPIDER &&
              file.name.toLowerCase().includes(userData.firstname.toLowerCase())),
        },
      ],
    },
    {
      id: 11,
      name: 'Handelsregisterauszug',
      ignore: (userData: UserData) => userData.accountType !== AccountType.ORGANIZATION,
      files: [
        {
          prefixes: (userData: UserData) => [`user/${userData.id}/CommercialRegister`],
          filter: (file: KycFileBlob, userData: UserData) =>
            userData.kycSteps.some(
              (s) => s.name === KycStepName.COMMERCIAL_REGISTER && s.isCompleted && s.result === file.url,
            ),
        },
      ],
    },
    {
      id: 12,
      name: 'Vollmacht',
      ignore: (userData: UserData) => userData.accountOpenerAuthorization !== 'Vollmacht',
      files: [
        {
          prefixes: (userData: UserData) => [`user/${userData.id}/Authority`],
          filter: (file: KycFileBlob, userData: UserData) =>
            userData.kycSteps.some((s) => s.name === KycStepName.AUTHORITY && s.isCompleted && s.result === file.url),
        },
      ],
    },
    {
      id: 13,
      name: 'Transaktionsliste Auditperiode 2025',
      files: [
        {
          prefixes: (userData: UserData) => [`user/${userData.id}/UserNotes`],
          fileTypes: [ContentType.PDF],
          filter: (file: KycFileBlob) => file.name.toLowerCase().includes('-TxAudit2025'.toLowerCase()),
        },
      ],
    },
    {
      id: 14,
      name: 'Name Check',
      files: [
        {
          prefixes: (userData: UserData) => [`user/${userData.id}/UserNotes`],
          fileTypes: [ContentType.PDF],
          filter: (file: KycFileBlob) => file.name.toLowerCase().includes('-NameCheck'.toLowerCase()),
        },
        {
          name: () => 'Dilisense Screening Report',
          prefixes: (userData: UserData) => [`user/${userData.id}/NameCheck`],
          fileTypes: [ContentType.PDF],
        },
      ],
    },
    {
      id: 15,
      name: 'Travel Rule',
      files: [
        {
          prefixes: (userData: UserData) => [`user/${userData.id}/UserNotes`],
          fileTypes: [ContentType.PDF],
          filter: (file: KycFileBlob) => file.name.toLowerCase().includes('-AddressSignature'.toLowerCase()),
          sort: (a: KycFileBlob, b: KycFileBlob) => (a.name.split('-')[0] < b.name.split('-')[0] ? a : b),
        },
      ],
    },
  ];

  support = {
    limitRequest: {
      mailName: process.env.LIMIT_REQUEST_SUPPORT_NAME,
      mailAddress: process.env.LIMIT_REQUEST_SUPPORT_MAIL,
      mailAddressSupportStaff: process.env.LIMIT_REQUEST_SUPPORT_STAFF_MAIL,
      mailBanner: process.env.LIMIT_REQUEST_SUPPORT_BANNER,
    },
    blackSquad: {
      link: process.env.BS_LINK,
      limit: 50000, // CHF
      mailName: process.env.BLACK_SQUAD_NAME,
      mailAddress: process.env.BLACK_SQUAD_MAIL,
      mailBanner: process.env.BLACK_SQUAD_BANNER,
    },
    message: {
      mailName: process.env.SUPPORT_MESSAGE_NAME,
      mailAddress: process.env.SUPPORT_MESSAGE_MAIL,
      mailBanner: process.env.SUPPORT_MESSAGE_BANNER,
    },
  };

  letter = {
    auth: { username: process.env.LETTER_USER, apikey: process.env.LETTER_AUTH },
    url: process.env.LETTER_URL,
  };

  frontend = {
    allowedUrls: (process.env.SERVICES_URL ?? '').split(';'),
    services: (process.env.SERVICES_URL ?? '').split(';')[0],
    payment: process.env.PAYMENT_URL,
  };

  fixer = {
    baseUrl: process.env.FIXER_BASE_URL,
    apiKey: process.env.FIXER_API_KEY,
  };

  mail: MailOptions = {
    options: {
      transport: {
        host: 'gateway.dfx.swiss',
        secure: true,
        port: 465,
        auth: {
          user: process.env.MAIL_USER,
          pass: process.env.MAIL_PASS,
        },
        tls: {
          rejectUnauthorized: false,
        },
      },
      template: {
        dir: join(process.cwd(), 'src/subdomains/supporting/notification/templates'),
        adapter: new HandlebarsAdapter(),
        options: {
          strict: true,
        },
      },
    },
    defaultMailTemplate: 'generic',
    contact: {
      supportMail: process.env.SUPPORT_MAIL || 'support@dfx.swiss',
      monitoringMail: process.env.MONITORING_MAIL || 'monitoring@dfx.swiss',
      liqMail: process.env.LIQ_MAIL || 'liq@dfx.swiss',
      noReplyMail: process.env.NOREPLY_MAIL || 'noreply@dfx.swiss',
    },
  };

  coinGecko = {
    apiKey: process.env.COIN_GECKO_API_KEY,
  };

  financialLog = {
    customAssets: process.env.CUSTOM_BALANCE_ASSETS?.split(';') ?? [], // asset uniqueName
    customAddresses: process.env.CUSTOM_BALANCE_ADDRESSES?.split(';') ?? [],
  };

  payment = {
    timeoutDelay: +(process.env.PAYMENT_TIMEOUT_DELAY ?? 0),
    evmSeed: process.env.PAYMENT_EVM_SEED,
    solanaSeed: process.env.PAYMENT_SOLANA_SEED,
    moneroAddress: process.env.PAYMENT_MONERO_ADDRESS,
    bitcoinAddress: process.env.PAYMENT_BITCOIN_ADDRESS,
    minConfirmations: (blockchain: Blockchain) => (blockchain === Blockchain.ETHEREUM ? 6 : 100),
    minVolume: 0.01, // CHF

    defaultPaymentTimeout: +(process.env.PAYMENT_TIMEOUT ?? 60),
    defaultEvmHexPaymentTryCount: +(process.env.PAYMENT_EVM_HEX_TRY_COUNT ?? 15),

    defaultForexFee: 0.01,
    addressForexFee: 0.02,
    defaultQuoteTimeout: 300, // sec
    addressQuoteTimeout: 7200, // sec

    manualMethods: ['KuCoinPay', 'BitcoinOnChainTaprootAsset'],

    webhookPublicKey: process.env.PAYMENT_WEBHOOK_PUBLIC_KEY?.split('<br>').join('\n'),
    webhookPrivateKey: process.env.PAYMENT_WEBHOOK_PRIVATE_KEY?.split('<br>').join('\n'),

    binancePayPublic: process.env.BINANCEPAY_PUBLIC_KEY,
    binancePaySecret: process.env.BINANCEPAY_SECRET_KEY,
    binancePayMerchantId: process.env.BINANCEPAY_MERCHANT_ID,

    checkbotSignTx: process.env.PAYMENT_CHECKBOT_SIGN_TX,
    checkbotPubKey: process.env.PAYMENT_CHECKBOT_PUB_KEY?.split('<br>').join('\n'),

    fee: (standard: PaymentStandard, currency: Fiat, asset: Asset): number => {
      if (currency.name === 'CHF' && asset.name === 'ZCHF') return 0;

      switch (standard) {
        case PaymentStandard.PAY_TO_ADDRESS:
          return this.payment.addressForexFee;

        default:
          return this.payment.defaultForexFee;
      }
    },

    quoteTimeout: (standard: PaymentStandard): number => {
      switch (standard) {
        case PaymentStandard.PAY_TO_ADDRESS:
          return this.payment.addressQuoteTimeout;

        default:
          return this.payment.defaultQuoteTimeout;
      }
    },
  };

  blockchain = {
    default: {
      user: process.env.NODE_USER,
      password: process.env.NODE_PASSWORD,
      inp: {
        active: process.env.NODE_INP_URL_ACTIVE,
        passive: process.env.NODE_INP_URL_PASSIVE,
      },
      dex: {
        active: process.env.NODE_DEX_URL_ACTIVE,
        passive: process.env.NODE_DEX_URL_PASSIVE,
        address: process.env.DEX_WALLET_ADDRESS,
      },
      btcInput: {
        active: process.env.NODE_BTC_INP_URL_ACTIVE,
        passive: process.env.NODE_BTC_INP_URL_PASSIVE,
      },
      btcOutput: {
        active: process.env.NODE_BTC_OUT_URL_ACTIVE,
        passive: process.env.NODE_BTC_OUT_URL_PASSIVE,
        address: process.env.BTC_OUT_WALLET_ADDRESS,
      },
      walletPassword: process.env.NODE_WALLET_PASSWORD,
      utxoSpenderAddress: process.env.UTXO_SPENDER_ADDRESS,
      minTxAmount: 0.00000297,
    },
    evm: {
      depositSeed: process.env.EVM_DEPOSIT_SEED,
      custodySeed: process.env.EVM_CUSTODY_SEED,
      minimalPreparationFee: 0.00000001,

      walletAccount: (accountIndex: number): WalletAccount => ({
        seed: this.blockchain.evm.depositSeed,
        index: accountIndex,
      }),

      custodyAccount: (accountIndex: number): WalletAccount => ({
        seed: this.blockchain.evm.custodySeed,
        index: accountIndex,
      }),
    },
    ethereum: {
      ethWalletAddress: process.env.ETH_WALLET_ADDRESS,
      ethWalletPrivateKey: process.env.ETH_WALLET_PRIVATE_KEY,
      ethGatewayUrl: process.env.ETH_GATEWAY_URL,
      ethApiKey: process.env.ALCHEMY_API_KEY,
      ethChainId: +process.env.ETH_CHAIN_ID,
      swapContractAddress: process.env.ETH_SWAP_CONTRACT_ADDRESS,
      quoteContractAddress: process.env.ETH_QUOTE_CONTRACT_ADDRESS,
    },
    optimism: {
      optimismWalletAddress: process.env.OPTIMISM_WALLET_ADDRESS,
      optimismWalletPrivateKey: process.env.OPTIMISM_WALLET_PRIVATE_KEY,
      optimismGatewayUrl: process.env.OPTIMISM_GATEWAY_URL,
      optimismApiKey: process.env.ALCHEMY_API_KEY,
      optimismChainId: +process.env.OPTIMISM_CHAIN_ID,
      swapContractAddress: process.env.OPTIMISM_SWAP_CONTRACT_ADDRESS,
      quoteContractAddress: process.env.OPTIMISM_QUOTE_CONTRACT_ADDRESS,
    },
    arbitrum: {
      arbitrumWalletAddress: process.env.ARBITRUM_WALLET_ADDRESS,
      arbitrumWalletPrivateKey: process.env.ARBITRUM_WALLET_PRIVATE_KEY,
      arbitrumGatewayUrl: process.env.ARBITRUM_GATEWAY_URL,
      arbitrumApiKey: process.env.ALCHEMY_API_KEY,
      arbitrumChainId: +process.env.ARBITRUM_CHAIN_ID,
      swapContractAddress: process.env.ARBITRUM_SWAP_CONTRACT_ADDRESS,
      quoteContractAddress: process.env.ARBITRUM_QUOTE_CONTRACT_ADDRESS,
    },
    polygon: {
      polygonWalletAddress: process.env.POLYGON_WALLET_ADDRESS,
      polygonWalletPrivateKey: process.env.POLYGON_WALLET_PRIVATE_KEY,
      polygonGatewayUrl: process.env.POLYGON_GATEWAY_URL,
      polygonApiKey: process.env.ALCHEMY_API_KEY,
      polygonChainId: +process.env.POLYGON_CHAIN_ID,
      swapContractAddress: process.env.POLYGON_SWAP_CONTRACT_ADDRESS,
      quoteContractAddress: process.env.POLYGON_QUOTE_CONTRACT_ADDRESS,
    },
    base: {
      baseWalletAddress: process.env.BASE_WALLET_ADDRESS,
      baseWalletPrivateKey: process.env.BASE_WALLET_PRIVATE_KEY,
      baseGatewayUrl: process.env.BASE_GATEWAY_URL,
      baseApiKey: process.env.ALCHEMY_API_KEY,
      baseChainId: +process.env.BASE_CHAIN_ID,
      swapContractAddress: process.env.BASE_SWAP_CONTRACT_ADDRESS,
      swapFactoryAddress: '0x33128a8fc17869897dce68ed026d694621f6fdfd',
      quoteContractAddress: process.env.BASE_QUOTE_CONTRACT_ADDRESS,
    },
    gnosis: {
      gnosisWalletAddress: process.env.GNOSIS_WALLET_ADDRESS,
      gnosisWalletPrivateKey: process.env.GNOSIS_WALLET_PRIVATE_KEY,
      gnosisGatewayUrl: process.env.GNOSIS_GATEWAY_URL,
      gnosisApiKey: process.env.ALCHEMY_API_KEY,
      gnosisChainId: +process.env.GNOSIS_CHAIN_ID,
      swapContractAddress: process.env.GNOSIS_SWAP_CONTRACT_ADDRESS,
      quoteContractAddress: process.env.GNOSIS_QUOTE_CONTRACT_ADDRESS,
    },
    bsc: {
      bscWalletAddress: process.env.BSC_WALLET_ADDRESS,
      bscWalletPrivateKey: process.env.BSC_WALLET_PRIVATE_KEY,
      bscGatewayUrl: process.env.BSC_GATEWAY_URL,
      bscApiKey: process.env.ALCHEMY_API_KEY,
      bscChainId: +process.env.BSC_CHAIN_ID,
      swapContractAddress: process.env.BSC_SWAP_CONTRACT_ADDRESS,
      quoteContractAddress: process.env.BSC_QUOTE_CONTRACT_ADDRESS,
      gasPrice: process.env.BSC_GAS_PRICE,
    },
    lightning: {
      lnbits: {
        apiKey: process.env.LIGHTNING_LNBITS_API_KEY,
        apiUrl: process.env.LIGHTNING_LNBITS_API_URL,
        lnurlpApiUrl: process.env.LIGHTNING_LNBITS_LNURLP_API_URL,
        lnurlpUrl: process.env.LIGHTNING_LNBITS_LNURLP_URL,
        lnurlwApiUrl: process.env.LIGHTNING_LNBITS_LNURLW_API_URL,
        signingPrivKey: process.env.LIGHTNING_SIGNING_PRIV_KEY?.split('<br>').join('\n'),
        signingPubKey: process.env.LIGHTNING_SIGNING_PUB_KEY?.split('<br>').join('\n'),
      },
      lnd: {
        apiUrl: process.env.LIGHTNING_LND_API_URL,
        adminMacaroon: process.env.LIGHTNING_LND_ADMIN_MACAROON,
      },
      certificate: process.env.LIGHTNING_API_CERTIFICATE?.split('<br>').join('\n'),
    },
    monero: {
      node: {
        url: process.env.MONERO_NODE_URL,
      },
      rpc: {
        url: process.env.MONERO_RPC_URL,
      },
      walletAddress: process.env.MONERO_WALLET_ADDRESS,
      certificate: process.env.MONERO_RPC_CERTIFICATE?.split('<br>').join('\n'),
    },
    solana: {
      solanaWalletSeed: process.env.SOLANA_WALLET_SEED,
      solanaGatewayUrl: process.env.SOLANA_GATEWAY_URL,
      solanaApiKey: process.env.TATUM_API_KEY,
      transactionPriorityRate: +(process.env.SOLANA_TRANSACTION_PRIORITY_RATE ?? 1),
      minimalCoinAccountRent: 0.00089088,
      createTokenAccountFee: 0.00203928,
      minimalPreparationFee: 0.00000001,

      walletAccount: (accountIndex: number): WalletAccount => ({
        seed: this.blockchain.solana.solanaWalletSeed,
        index: accountIndex,
      }),
    },
    frankencoin: {
      zchfGraphUrl: process.env.ZCHF_GRAPH_URL,
      contractAddress: {
        zchf: process.env.ZCHF_CONTRACT_ADDRESS,
        equity: process.env.ZCHF_EQUITY_CONTRACT_ADDRESS,
        stablecoinBridge: process.env.ZCHF_STABLECOIN_BRIDGE_CONTRACT_ADDRESS,
        xchf: process.env.ZCHF_XCHF_CONTRACT_ADDRESS,
        fpsWrapper: process.env.ZCHF_FPS_WRAPPER_CONTRACT_ADDRESS,
      },
    },
    deuro: {
      graphUrl: process.env.DEURO_GRAPH_URL,
      apiUrl: process.env.DEURO_API_URL,
    },
    ebel2x: {
      contractAddress: process.env.EBEL2X_CONTRACT_ADDRESS,
    },
  };

  payIn = {
    minDeposit: {
      Bitcoin: {
        BTC: 0.000001,
      },
      Monero: {
        XMR: 0.000001,
      },
    },
  };

  buy = {
    fee: {
      limit: +(process.env.BUY_CRYPTO_FEE_LIMIT ?? 0.001),
    },
  };

  exchange: ExchangeConfig = {
    enableRateLimit: true,
    rateLimit: 500,
    timeout: 30000,
  };

  exchangeTxSyncLimit = +(process.env.EXCHANGE_TX_SYNC_LIMIT ?? 720); // minutes

  dilisense = {
    jsonPath: process.env.DILISENSE_JSON_PATH,
    key: process.env.DILISENSE_KEY,
  };

  sepaTools = {
    auth: {
      username: process.env.SEPA_TOOLS_USER,
      password: process.env.SEPA_TOOLS_PASSWORD,
    },
  };

  ikna = {
    Authorization: process.env.IKNA_KEY,
  };

  invoice = {
    currencies: ['EUR', 'CHF'],
    defaultCurrency: 'CHF',
  };

  bank = {
    dfxAddress: {
      name: 'DFX AG',
      street: 'Bahnhofstrasse',
      number: '7',
      zip: '6300',
      city: 'Zug',
      country: 'Schweiz',
    },
    olkypay: {
      credentials: {
        clientId: process.env.OLKY_CLIENT,
        username: process.env.OLKY_USERNAME,
        password: process.env.OLKY_PASSWORD,
        clientSecret: process.env.OLKY_CLIENT_SECRET,
      },
    },
    frick: {
      credentials: {
        url: process.env.FRICK_URL,
        key: process.env.FRICK_KEY,
        password: process.env.FRICK_PASSWORD,
        privateKey: process.env.FRICK_PRIVATE_KEY?.split('<br>').join('\n'),
      },
    },
    revolut: {
      refreshToken: process.env.REVOLUT_REFRESH_TOKEN,
      clientAssertion: process.env.REVOLUT_CLIENT_ASSERTION,
    },
    forexFee: 0.02,
  };

  giroCode = {
    service: 'BCD',
    version: '001',
    encoding: '2',
    transfer: 'SCT',
    char: '',
    ref: '',
  };

  azure = {
    subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
    tenantId: process.env.AZURE_TENANT_ID,
    clientId: process.env.AZURE_CLIENT_ID,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
    storage: {
      url: process.env.AZURE_STORAGE_CONNECTION_STRING?.split(';')
        .find((p) => p.includes('BlobEndpoint'))
        ?.replace('BlobEndpoint=', ''),
      connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
    },
  };

  alby = {
    clientId: process.env.ALBY_CLIENT_ID,
    clientSecret: process.env.ALBY_CLIENT_SECRET,
  };

  alchemy = {
    apiKey: process.env.ALCHEMY_API_KEY,
    authToken: process.env.ALCHEMY_AUTH_TOKEN,
  };

  tatum = {
    apiKey: process.env.TATUM_API_KEY,
    hmacKey: process.env.TATUM_HMAC_KEY,
  };

  request = {
    knownIps: process.env.REQUEST_KNOWN_IPS?.split(',') ?? [],
    limitCheck: process.env.REQUEST_LIMIT_CHECK === 'true',
  };

  sift = {
    apiKey: process.env.SIFT_API_KEY,
    accountId: process.env.SIFT_ACCOUNT_ID,
    analyst: process.env.SIFT_ANALYST,
  };

  checkout = {
    entityId: process.env.CKO_ENTITY_ID,
  };

  cronJobDelay = process.env.CRON_JOB_DELAY?.split(';').map(Number) ?? [];

  // --- GETTERS --- //
  url(version: Version = this.defaultVersion): string {
    const versionString = `v${version}`;
    return this.environment === Environment.LOC
      ? `http://localhost:${this.port}/${versionString}`
      : `https://${this.environment === Environment.PRD ? '' : this.environment + '.'}api.dfx.swiss/${versionString}`;
  }

  get kraken(): ExchangeConfig {
    return {
      apiKey: process.env.KRAKEN_KEY,
      secret: process.env.KRAKEN_SECRET,
      withdrawKeys: splitWithdrawKeys(process.env.KRAKEN_WITHDRAW_KEYS),
      ...this.exchange,
    };
  }

  get binance(): ExchangeConfig {
    return {
      apiKey: process.env.BINANCE_KEY,
      secret: process.env.BINANCE_SECRET,
      withdrawKeys: splitWithdrawKeys(process.env.BINANCE_WITHDRAW_KEYS),
      quoteJsonNumbers: false,
      ...this.exchange,
    };
  }

  get p2b(): ExchangeConfig {
    return {
      apiKey: process.env.P2B_KEY,
      secret: process.env.P2B_SECRET,
      withdrawKeys: splitWithdrawKeys(process.env.P2B_WITHDRAW_KEYS),
      ...this.exchange,
    };
  }

  get evmWallets(): Map<string, string> {
    return splitWithdrawKeys(process.env.EVM_WALLETS);
  }

  // --- HELPERS --- //
  disabledProcesses = () =>
    process.env.DISABLED_PROCESSES === '*'
      ? Object.values(Process)
      : ((process.env.DISABLED_PROCESSES?.split(',') ?? []) as Process[]);
}

function splitWithdrawKeys(value?: string): Map<string, string> {
  return (value?.split(',') ?? [])
    .map((k) => k.split(':'))
    .reduce((prev, [key, value]) => prev.set(key, value), new Map<string, string>());
}

@Injectable()
export class ConfigService {
  constructor(@Optional() readonly config?: Configuration) {
    Config = config ?? GetConfig();
  }
}

export let Config: Configuration;
