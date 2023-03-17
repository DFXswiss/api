import { Injectable, Optional } from '@nestjs/common';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Exchange } from 'ccxt';
import { I18nJsonParser, I18nOptions } from 'nestjs-i18n';
import { join } from 'path';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { MailOptions } from 'src/subdomains/supporting/notification/services/mail.service';
import { Asset, FeeTier } from 'src/shared/models/asset/asset.entity';
import { MinDeposit } from 'src/subdomains/supporting/address-pool/deposit/dto/min-deposit.dto';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';

export enum Process {
  PAY_IN = 'PayIn',
  LIMIT_REQUEST_MAIL = 'LimitRequestMail',
  BLACK_SQUAD_MAIL = 'BlackSquadMail',
  BUY_CRYPTO_MAIL = 'BuyCryptoMail',
  BUY_FIAT_MAIL = 'BuyFiatMail',
}

export function GetConfig(): Configuration {
  return new Configuration();
}

export class Configuration {
  environment = process.env.ENVIRONMENT;
  network = process.env.NETWORK;
  githubToken = process.env.GH_TOKEN;
  defaultLanguage = 'en';
  defaultCountry = 'DE';
  defaultCurrency = 'EUR';
  defaultTelegramUrl = 'https://t.me/DFXswiss';
  defaultLinkedinUrl = 'https://www.linkedin.com/company/dfxswiss/';
  defaultInstagramUrl = 'https://www.instagram.com/dfx.swiss/';
  defaultTwitterUrl = 'https://twitter.com/DFX_Swiss';
  defaultVolumeDecimal = 2;
  defaultPercentageDecimal = 2;
  defaultDailyTradingLimit = 990; // EUR
  apiKeyVersionCT = '0'; // single digit hex number
  azureIpSubstring = '169.254';

  colors = {
    white: '#FFFFFF',
    red: '#F5516C',
    lightBlue: '#0A355C',
    darkBlue: '#072440',
  };

  formats = {
    address:
      this.environment === 'prd'
        ? /^(8\w{33}|d\w{33}|d\w{41}|0x\w{40}|(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39})$/
        : /^((7|8)\w{33}|(t|d)\w{33}|(t|d)\w{41}|0x\w{40}|(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}|stake[a-z0-9]{54})$/,
    signature: /^(.{87}=|[a-f0-9]{130}|[a-f0-9x]{132}|[a-f0-9]{582})$/,
    key: /^[a-f0-9]{84}$/,
    ref: /^(\w{1,3}-\w{1,3})$/,
  };

  database: TypeOrmModuleOptions = {
    type: 'mssql',
    host: process.env.SQL_HOST,
    port: Number.parseInt(process.env.SQL_PORT),
    username: process.env.SQL_USERNAME,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB,
    entities: ['dist/**/*.entity{.ts,.js}'],
    synchronize: process.env.SQL_SYNCHRONIZE === 'true',
    migrationsRun: process.env.SQL_MIGRATE === 'true',
    migrations: ['migration/*.js'],
    cli: {
      migrationsDir: 'migration',
    },
    connectionTimeout: 30000,
    requestTimeout: 30000,
  };

  i18n: I18nOptions = {
    fallbackLanguage: this.defaultLanguage,
    parser: I18nJsonParser,
    parserOptions: {
      path: join(__dirname, '../shared/i18n/'),
      watch: true,
    },
  };

  mydefichain = {
    username: process.env.MYDEFICHAIN_USER,
    password: process.env.MYDEFICHAIN_PASSWORD,
  };

  auth = {
    jwt: {
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: process.env.JWT_EXPIRES_IN ?? 172800,
      },
    },
    company: {
      signOptions: {
        expiresIn: process.env.JWT_EXPIRES_IN_COMPANY ?? 30,
      },
    },
    challenge: {
      expiresIn: +(process.env.CHALLENGE_EXPIRES_IN ?? 10),
    },
    signMessage:
      'By_signing_this_message,_you_confirm_that_you_are_the_sole_owner_of_the_provided_DeFiChain_address_and_are_in_possession_of_its_private_key._Your_ID:_',
    signMessageGeneral:
      'By_signing_this_message,_you_confirm_that_you_are_the_sole_owner_of_the_provided_Blockchain_address._Your_ID:_',
  };

  kyc = {
    mandator: process.env.KYC_MANDATOR,
    user: process.env.KYC_USER,
    password: process.env.KYC_PASSWORD,
    prefix: process.env.KYC_PREFIX ?? '',
    reminderAfterDays: 2,
    failAfterDays: 7,
    chatbotStyle: {
      headerColor: this.colors.white,
      textColor: this.colors.white,
      warningColor: this.colors.red,
      backgroundColor: this.colors.darkBlue,
      overlayBackgroundColor: this.colors.darkBlue,
      buttonColor: this.colors.white,
      buttonBackgroundColor: this.colors.red,
      bubbleLeftColor: this.colors.white,
      bubbleLeftBackgroundColor: this.colors.lightBlue,
      bubbleRightColor: this.colors.white,
      bubbleRightBackgroundColor: this.colors.lightBlue,
      htmlHeaderInclude: '',
      htmlBodyInclude: '',
    },
    allowedWebhookIps: process.env.KYC_WEBHOOK_IPS?.split(','),
  };

  support = {
    limitRequest: {
      mailName: process.env.LIMIT_REQUEST_SUPPORT_NAME,
      mailAddress: process.env.LIMIT_REQUEST_SUPPORT_MAIL,
      mailBanner: process.env.LIMIT_REQUEST_SUPPORT_BANNER,
    },
    blackSquad: {
      link: process.env.BS_LINK,
      limit: 50000,
      mailName: process.env.BLACK_SQUAD_NAME,
      mailAddress: process.env.BLACK_SQUAD_MAIL,
      mailBanner: process.env.BLACK_SQUAD_BANNER,
    },
  };

  letter = {
    auth: { username: process.env.LETTER_USER, apikey: process.env.LETTER_AUTH },
    url: process.env.LETTER_URL,
  };

  payment = {
    url: process.env.PAYMENT_URL,
  };

  fixer = {
    baseUrl: process.env.FIXER_BASE_URL,
    apiKey: process.env.FIXER_API_KEY,
  };

  externalKycServices = {
    'LOCK.space': {
      apiKey: process.env.LOCK_API_KEY,
    },
    'LOCK.space STG': {
      apiKey: process.env.LOCK_API_KEY,
    },
    Talium: {
      apiKey: process.env.TALIUM_API_KEY,
    },
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
        dir: join(__dirname, '../subdomains/supporting/notification/templates'),
        adapter: new HandlebarsAdapter(),
        options: {
          strict: true,
        },
      },
    },
    defaultMailTemplate: 'support',
    contact: {
      supportMail: process.env.SUPPORT_MAIL || 'support@dfx.swiss',
      monitoringMail: process.env.MONITORING_MAIL || 'monitoring@dfx.swiss',
      liqMail: process.env.LIQ_MAIL || 'liq@dfx.swiss',
      noReplyMail: process.env.NOREPLY_MAIL || 'noreply@dfx.swiss',
    },
  };

  whale = {
    version: 'v0',
    network: this.network,
    url: 'https://ocean.defichain.com',
  };

  transaction = {
    minVolume: {
      // blockchain: { outputAsset: { minTransactionAsset: minTransactionVolume }}
      Fiat: {
        USD: {
          USD: 1000,
        },
      },
      Bitcoin: {
        BTC: {
          USD: 10,
          CHF: 10,
          EUR: 10,
        },
      },
      BinanceSmartChain: {
        default: {
          USD: 10,
          CHF: 10,
          EUR: 10,
        },
      },
      Arbitrum: {
        default: {
          USD: 25,
          CHF: 25,
          EUR: 25,
        },
      },
      Optimism: {
        default: {
          USD: 25,
          CHF: 25,
          EUR: 25,
        },
      },
      Ethereum: {
        default: {
          USD: 1000,
          CHF: 1000,
          EUR: 1000,
        },
      },
      default: {
        USD: 1,
        CHF: 1,
        EUR: 1,
      },

      get: (target: Asset | Fiat, referenceCurrency: string): MinDeposit => {
        const minDeposits = this.transaction.minVolume.getMany(target);
        return minDeposits.find((d) => d.asset === referenceCurrency) ?? minDeposits.find((d) => d.asset === 'USD');
      },

      getMany: (target: Asset | Fiat): MinDeposit[] => {
        const system = 'blockchain' in target ? target.blockchain : 'Fiat';
        const asset = target.name;

        const minVolume =
          this.transaction.minVolume[system]?.[asset] ??
          this.transaction.minVolume[system]?.default ??
          this.transaction.minVolume.default;

        return this.transformToMinDeposit(minVolume);
      },
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
      },
      out: {
        active: process.env.NODE_OUT_URL_ACTIVE,
        passive: process.env.NODE_OUT_URL_PASSIVE,
      },
      int: {
        active: process.env.NODE_INT_URL_ACTIVE,
        passive: process.env.NODE_INT_URL_PASSIVE,
      },
      ref: {
        active: process.env.NODE_REF_URL_ACTIVE,
        passive: process.env.NODE_REF_URL_PASSIVE,
      },
      btcInput: {
        active: process.env.NODE_BTC_INP_URL_ACTIVE,
        passive: process.env.NODE_BTC_INP_URL_PASSIVE,
      },
      btcOutput: {
        active: process.env.NODE_BTC_OUT_URL_ACTIVE,
        passive: process.env.NODE_BTC_OUT_URL_PASSIVE,
      },
      walletPassword: process.env.NODE_WALLET_PASSWORD,
      utxoSpenderAddress: process.env.UTXO_SPENDER_ADDRESS,
      dexWalletAddress: process.env.DEX_WALLET_ADDRESS,
      outWalletAddress: process.env.OUT_WALLET_ADDRESS,
      intWalletAddress: process.env.INT_WALLET_ADDRESS,
      stakingWalletAddress: process.env.STAKING_WALLET_ADDRESS,
      btcOutWalletAddress: process.env.BTC_OUT_WALLET_ADDRESS,
      minTxAmount: 0.00000297,
      minDeposit: {
        Bitcoin: {
          BTC: 0.0005,
        },
        DeFiChain: {
          DFI: 0.01,
          USDT: 0.4,
        },
      },
    },
    evm: {
      encryptionKey: process.env.EVM_ENCRYPTION_KEY,
      minimalPreparationFee: 0.00000001,
    },
    ethereum: {
      ethScanApiUrl: process.env.ETH_SCAN_API_URL,
      ethScanApiKey: process.env.ETH_SCAN_API_KEY,
      ethWalletAddress: process.env.ETH_WALLET_ADDRESS,
      ethWalletPrivateKey: process.env.ETH_WALLET_PRIVATE_KEY,
      ethGatewayUrl: process.env.ETH_GATEWAY_URL,
      ethApiKey: process.env.ETH_API_KEY,
      ethChainId: process.env.ETH_CHAIN_ID,
      uniswapV2Router02Address: process.env.ETH_SWAP_CONTRACT_ADDRESS,
      swapTokenAddress: process.env.ETH_SWAP_TOKEN_ADDRESS,
    },
    bsc: {
      bscScanApiUrl: process.env.BSC_SCAN_API_URL,
      bscScanApiKey: process.env.BSC_SCAN_API_KEY,
      bscWalletAddress: process.env.BSC_WALLET_ADDRESS,
      bscWalletPrivateKey: process.env.BSC_WALLET_PRIVATE_KEY,
      bscGatewayUrl: process.env.BSC_GATEWAY_URL,
      pancakeRouterAddress: process.env.BSC_SWAP_CONTRACT_ADDRESS,
      swapTokenAddress: process.env.BSC_SWAP_TOKEN_ADDRESS,
    },
    optimism: {
      optimismScanApiUrl: process.env.OPTIMISM_SCAN_API_URL,
      optimismScanApiKey: process.env.OPTIMISM_SCAN_API_KEY,
      optimismWalletAddress: process.env.OPTIMISM_WALLET_ADDRESS,
      optimismWalletPrivateKey: process.env.OPTIMISM_WALLET_PRIVATE_KEY,
      optimismGatewayUrl: process.env.OPTIMISM_GATEWAY_URL,
      optimismApiKey: process.env.OPTIMISM_API_KEY,
      optimismChainId: process.env.OPTIMISM_CHAIN_ID,
      pancakeRouterAddress: process.env.OPTIMISM_SWAP_CONTRACT_ADDRESS,
      swapTokenAddress: process.env.OPTIMISM_SWAP_TOKEN_ADDRESS,
    },
    arbitrum: {
      arbitrumScanApiUrl: process.env.ARBITRUM_SCAN_API_URL,
      arbitrumScanApiKey: process.env.ARBITRUM_SCAN_API_KEY,
      arbitrumWalletAddress: process.env.ARBITRUM_WALLET_ADDRESS,
      arbitrumWalletPrivateKey: process.env.ARBITRUM_WALLET_PRIVATE_KEY,
      arbitrumGatewayUrl: process.env.ARBITRUM_GATEWAY_URL,
      arbitrumApiKey: process.env.ARBITRUM_API_KEY,
      pancakeRouterAddress: process.env.ARBITRUM_SWAP_CONTRACT_ADDRESS,
      swapTokenAddress: process.env.ARBITRUM_SWAP_TOKEN_ADDRESS,
    },
  };

  buy = {
    fee: {
      organization: {
        [FeeTier.TIER0]: 0,
        [FeeTier.TIER1]: 0.0149,
        [FeeTier.TIER2]: 0.0199,
        [FeeTier.TIER3]: 0.0275,
        [FeeTier.TIER4]: 0.0349,
      },
      private: {
        [FeeTier.TIER0]: 0,
        [FeeTier.TIER1]: 0.0099,
        [FeeTier.TIER2]: 0.0149,
        [FeeTier.TIER3]: 0.0225,
        [FeeTier.TIER4]: 0.0299,
      },
      limits: {
        configuredFeeLimit: this.configuredFeeLimit,
        defaultFeeLimit: 0.005,
      },
    },
  };

  sell = {
    fee: {
      organization: {
        [FeeTier.TIER0]: 0,
        [FeeTier.TIER1]: 0.0199,
        [FeeTier.TIER2]: 0.0249,
        [FeeTier.TIER3]: 0.0325,
        [FeeTier.TIER4]: 0.0399,
      },
      private: {
        [FeeTier.TIER0]: 0,
        [FeeTier.TIER1]: 0.0149,
        [FeeTier.TIER2]: 0.0199,
        [FeeTier.TIER3]: 0.0275,
        [FeeTier.TIER4]: 0.0349,
      },
    },
  };

  staking = {
    fee: 0.125,
    period: 28, // days
    minInvestment: 100, // DFI
    freeDays: 28,
    refSystemStart: new Date('2022-05-22T16:00:00.000Z'),
    refReward: 20, // EUR
  };

  crypto = {
    fee: 0,
    refBonus: 0.001,
  };

  ftp = {
    host: process.env.FTP_HOST,
    user: process.env.FTP_USER,
    password: process.env.FTP_PASSWORD,
    directory: process.env.FTP_FOLDER,
  };

  exchange: Partial<Exchange> = {
    enableRateLimit: true,
    timeout: 30000,
  };

  sepaTools = {
    auth: {
      username: process.env.SEPA_TOOLS_USER,
      password: process.env.SEPA_TOOLS_PASSWORD,
    },
  };

  bank = {
    dfxBankInfo: {
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
  };

  chainalysis = {
    apiKey: process.env.CHAINALYSIS_API_KEY,
  };

  azure = {
    subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
    tenantId: process.env.AZURE_TENANT_ID,
    clientId: process.env.AZURE_CLIENT_ID,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
  };

  request = {
    knownIps: process.env.REQUEST_KNOWN_IPS?.split(',') ?? [],
    limitCheck: process.env.REQUEST_LIMIT_CHECK === 'true',
  };

  // --- GETTERS --- //
  get kraken(): Partial<Exchange> {
    return {
      apiKey: process.env.KRAKEN_KEY,
      secret: process.env.KRAKEN_SECRET,
      ...this.exchange,
    };
  }

  get binance(): Partial<Exchange> {
    return {
      apiKey: process.env.BINANCE_KEY,
      secret: process.env.BINANCE_SECRET,
      ...this.exchange,
    };
  }

  get configuredFeeLimit(): number | null {
    const limit = Number.parseFloat(process.env.BUY_CRYPTO_FEE_LIMIT);

    return Number.isNaN(limit) ? null : limit;
  }

  // --- HELPERS --- //
  transformToMinDeposit = (deposit: { [asset: string]: number }, filter?: string[] | string): MinDeposit[] =>
    Object.entries(deposit)
      .filter(([key, _]) => filter?.includes(key) ?? true)
      .map(([key, value]) => ({ amount: value, asset: key }));

  processDisabled = (processName: Process) =>
    process.env.DISABLED_PROCESSES === '*' || (process.env.DISABLED_PROCESSES?.split(',') ?? []).includes(processName);
}

@Injectable()
export class ConfigService {
  constructor(@Optional() readonly config?: Configuration) {
    Config = config ?? GetConfig();
  }
}

export let Config: Configuration;
