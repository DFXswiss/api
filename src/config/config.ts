import { Injectable, Optional } from '@nestjs/common';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Exchange } from 'ccxt';
import { I18nJsonParser, I18nOptions } from 'nestjs-i18n';
import * as path from 'path';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { MailOptions } from 'src/shared/services/mail.service';

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
  apiKeyVersionCT = '0'; // single digit hex number

  colors = {
    white: '#FFFFFF',
    red: '#F5516C',
    lightBlue: '#0A355C',
    darkBlue: '#072440',
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
      path: path.join(__dirname, '../shared/i18n/'),
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
    signMessage:
      'By_signing_this_message,_you_confirm_that_you_are_the_sole_owner_of_the_provided_DeFiChain_address_and_are_in_possession_of_its_private_key._Your_ID:_',
    signMessageWallet:
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

  lock = {
    apiKey: process.env.LOCK_API_KEY,
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
        dir: path.join(__dirname, '../shared/assets/mails'),
        adapter: new HandlebarsAdapter(),
        options: {
          strict: true,
        },
      },
    },
    defaultMailTemplate: 'personal',
    contact: {
      supportMail: process.env.SUPPORT_MAIL || 'support@dfx.swiss',
      monitoringMail: process.env.MONITORING_MAIL || 'monitoring@dfx.swiss',
      noReplyMail: process.env.NOREPLY_MAIL || 'noreply@dfx.swiss',
    },
  };

  whale = {
    version: 'v0',
    network: this.network,
    url: 'https://ocean.defichain.com',
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
      btcCollectorAddress: process.env.BTC_COLLECTOR_ADDRESS,
      minTxAmount: 0.00000297,
      minDeposit: {
        Fiat: {
          USD: 1,
        },
        Bitcoin: {
          BTC: 0.0005,
        },
        DeFiChain: {
          DFI: 0.01,
          USD: 1,
        },
      },
    },
    ethereum: {
      ethWalletAddress: process.env.ETH_WALLET_ADDRESS,
      ethWalletPrivateKey: process.env.ETH_WALLET_PRIVATE_KEY,
      ethGatewayUrl: process.env.ETH_GATEWAY_URL,
      ethApiKey: process.env.ETH_API_KEY,
    },
    bsc: {
      bscWalletAddress: process.env.BSC_WALLET_ADDRESS,
      bscWalletPrivateKey: process.env.BSC_WALLET_PRIVATE_KEY,
      bscGatewayUrl: process.env.BSC_GATEWAY_URL,
    },
  };

  buy = {
    fee: {
      organization: 2.9,
      private: {
        base: 2.9,
        moreThan5k: 2.65,
        moreThan50k: 2.4,
        moreThan100k: 2.3,
      },
    },
  };

  sell = {
    fee: 0.029,
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
    fee: 0.012,
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
      account: { currency: 'EUR', iban: 'LU116060002000005040', bic: 'OLKILUL1' },
    },
    maerkiBaumann: {
      accounts: [
        { currency: 'EUR', iban: 'CH6808573177975201814', bic: 'MAEBCHZZ' },
        { currency: 'CHF', iban: 'CH3408573177975200001', bic: 'MAEBCHZZ' },
      ],
    },
    frick: {
      credentials: {
        url: process.env.FRICK_URL,
        key: process.env.FRICK_KEY,
        password: process.env.FRICK_PASSWORD,
        privateKey: process.env.FRICK_PRIVATE_KEY?.split('<br>').join('\n'),
      },
      accounts: [
        { currency: 'EUR', iban: 'LI95088110104693K000E', bic: 'BFRILI22' },
        { currency: 'CHF', iban: 'LI52088110104693K000C', bic: 'BFRILI22' },
        { currency: 'USD', iban: 'LI51088110104693K000U', bic: 'BFRILI22' },
      ],
    },
  };

  chainalysis = {
    apiKey: process.env.CHAINALYSIS_API_KEY,
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

  get addressFormat(): RegExp {
    return this.environment === 'prd'
      ? /^(8\w{33}|d\w{33}|d\w{41}|0x\w{40}|(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39})$/
      : /^((7|8)\w{33}|(t|d)\w{33}|(t|d)\w{41}|0x\w{40}|(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39})$/;
  }

  get signatureFormat(): RegExp {
    return /^(.{87}=|[a-f0-9]{130}|[a-f0-9x]{132})$/;
  }
}

@Injectable()
export class ConfigService {
  constructor(@Optional() readonly config?: Configuration) {
    Config = config ?? GetConfig();
  }
}

export let Config: Configuration;
