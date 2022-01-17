import { MailerOptions } from '@nestjs-modules/mailer';
import { JwtModuleOptions } from '@nestjs/jwt';
import { Exchange } from 'ccxt';

export abstract class IConfig {
  environment: string;
  githubToken: string;
  defaultLanguage: string;
  defaultCountry: string;
  defaultCurrency: string;

  database: {
    type: 'mssql';
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    entities: string[];
    synchronize: boolean;
    migrationsRun: boolean;
    migrations: string[];
    cli: {
      migrationsDir: string;
    };
    connectionTimeout: number;
  };

  auth: {
    jwt: JwtModuleOptions;
    signMessage: string;
    signMessageWallet: string;
  };

  kyc: {
    mandator: string;
    user: string;
    password: string;
    prefix: string;
  };

  mail: MailerOptions;

  node: {
    user: string;
    password: string;
    inp: {
      active: string;
      passive: string;
    };
    dex: {
      active: string;
      passive: string;
    };
    out: {
      active: string;
      passive: string;
    };
    int: {
      active: string;
      passive: string;
    };
    walletPassword: string;
    dexWalletAddress: string;
  };

  ftp: {
    host: string;
    user: string;
    password: string;
    directory: string;
  };

  kraken: Partial<Exchange>;
}

export function GetConfig(): IConfig {
  return {
    environment: process.env.ENVIRONMENT,
    githubToken: process.env.GH_TOKEN,
    defaultLanguage: 'de',
    defaultCountry: 'DE',
    defaultCurrency: 'EUR',

    database: {
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
    },

    auth: {
      jwt: {
        secret: process.env.JWT_SECRET,
        signOptions: {
          expiresIn: 172800,
        },
      },
      signMessage: process.env.SIGN_MESSAGE,
      signMessageWallet: process.env.SIGN_MESSAGE_WALLET,
    },

    kyc: {
      mandator: process.env.KYC_MANDATOR,
      user: process.env.KYC_USER,
      password: process.env.KYC_PASSWORD,
      prefix: process.env.KYC_PREFIX,
    },

    mail: {
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
    },

    node: {
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
      dexWalletAddress: process.env.DEX_WALLET_ADDRESS,
    },

    ftp: {
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD,
      directory: process.env.FTP_FOLDER,
    },

    kraken: {
      apiKey: process.env.KRAKEN_KEY,
      secret: process.env.KRAKEN_SECRET,
      enableRateLimit: true,
      timeout: 30000,
    },
  };
}

export const Config = {} as IConfig;
