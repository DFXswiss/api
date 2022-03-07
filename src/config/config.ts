import { MailerOptions } from '@nestjs-modules/mailer';
import { Injectable, Optional } from '@nestjs/common';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Exchange } from 'ccxt';
import { I18nJsonParser, I18nOptions } from 'nestjs-i18n';
import * as path from 'path';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';

export function GetConfig(): Configuration {
  return new Configuration();
}

export class Configuration {
  environment = process.env.ENVIRONMENT;
  githubToken = process.env.GH_TOKEN;
  defaultLanguage = 'de';
  defaultCountry = 'DE';
  defaultCurrency = 'EUR';
  defaultTelegramUrl = 'https://t.me/DFXswiss';
  defaultLinkedinUrl = 'https://www.linkedin.com/company/dfxswiss/';
  defaultInstagramUrl = 'https://www.instagram.com/dfx.swiss/';
  defaultTwitterUrl = 'https://twitter.com/DFX_Swiss';
  defaultMailTemplate = 'personal';
  stakingPeriod = 365; // TODO: 28; // days

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
  };

  i18n: I18nOptions = {
    fallbackLanguage: this.defaultLanguage,
    parser: I18nJsonParser,
    parserOptions: {
      path: path.join(__dirname, '../shared/i18n/'),
      watch: true,
    },
  };

  auth = {
    jwt: {
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: 172800,
      },
    },
    signMessage: process.env.SIGN_MESSAGE,
    signMessageWallet: process.env.SIGN_MESSAGE_WALLET,
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
  };

  mail: MailerOptions = {
    transport: {
      host: 'smtp.gmail.com',
      secure: false,
      auth: {
        type: 'OAuth2',
        user: process.env.MAIL_USER,
        clientId: process.env.MAIL_CLIENT_ID,
        clientSecret: process.env.MAIL_CLIENT_SECRET,
        refreshToken: process.env.MAIL_REFRESH_TOKEN,
      },
      tls: {
        rejectUnauthorized: false,
      },
    },
    defaults: {
      from: '"DFX.swiss" <' + process.env.MAIL_USER + '>',
    },
    template: {
      dir: path.join(__dirname, '../shared/assets/mails'),
      adapter: new HandlebarsAdapter(),
      options: {
        strict: true,
      },
    },
  };

  node = {
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
    walletPassword: process.env.NODE_WALLET_PASSWORD,
    utxoSpenderAddress: process.env.UTXO_SPENDER_ADDRESS,
    dexWalletAddress: process.env.DEX_WALLET_ADDRESS,
    stakingWalletAddress: process.env.STAKING_WALLET_ADDRESS,
    minDfiDeposit: 0.01,
    minTokenDeposit: 1, // USDT
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
}

@Injectable()
export class ConfigService {
  constructor(@Optional() readonly config?: Configuration) {
    Config = config ?? GetConfig();
  }
}

export let Config: Configuration;
