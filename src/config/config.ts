import { NetworkName } from '@defichain/jellyfish-network';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { Injectable, Optional } from '@nestjs/common';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Exchange } from 'ccxt';
import { I18nOptions } from 'nestjs-i18n';
import { join } from 'path';
import { WalletAccount } from 'src/integration/blockchain/shared/evm/domain/wallet-account';
import { Process } from 'src/shared/services/process.service';
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
  defaultVersion: Version = '1';
  kycVersion: Version = '2';
  defaultVersionString = `v${this.defaultVersion}`;
  network = process.env.NETWORK as NetworkName;
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
  defaultDailyTradingLimit = 1000; // CHF
  defaultTradingLimit = 1000000000; // CHF
  defaultCardTradingLimit = 4000; // CHF
  apiKeyVersionCT = '0'; // single digit hex number
  azureIpSubstring = '169.254';
  amlCheckMonthlyTradingLimit = 50000; // EUR

  colors = {
    white: '#FFFFFF',
    red: '#F5516C',
    lightBlue: '#0A355C',
    darkBlue: '#072440',
  };

  bitcoinAddressFormat = '([13]|bc1)[a-zA-HJ-NP-Z0-9]{25,62}';
  lightningAddressFormat = '(LNURL|LNDHUB)[A-Z0-9]{25,250}|LNNID[A-Z0-9]{66}';
  moneroAddressFormat = '[48][0-9AB][1-9A-HJ-NP-Za-km-z]{93}';
  ethereumAddressFormat = '0x\\w{40}';
  liquidAddressFormat = '(VTp|VJL)[a-zA-HJ-NP-Z0-9]{77}';
  cardanoAddressFormat = 'stake[a-z0-9]{54}';
  defichainAddressFormat =
    this.environment === Environment.PRD ? '8\\w{33}|d\\w{33}|d\\w{41}' : '[78]\\w{33}|[td]\\w{33}|[td]\\w{41}';

  allAddressFormat = `${this.bitcoinAddressFormat}|${this.lightningAddressFormat}|${this.moneroAddressFormat}|${this.ethereumAddressFormat}|${this.liquidAddressFormat}|${this.cardanoAddressFormat}|${this.defichainAddressFormat}`;

  masterKeySignatureFormat = '[0-9a-fA-F]{8}\\b-[0-9a-fA-F]{4}\\b-[0-9a-fA-F]{4}\\b-[0-9a-fA-F]{4}\\b-[0-9a-fA-F]{12}';
  hashSignatureFormat = '[A-Fa-f0-9]{64}';
  bitcoinSignatureFormat = '.{87}=';
  lightningSignatureFormat = '[a-z0-9]{104}';
  lightningCustodialSignatureFormat = '[a-z0-9]{140,146}';
  moneroSignatureFormat = 'SigV\\d[0-9a-zA-Z]{88}';
  ethereumSignatureFormat = '(0x)?[a-f0-9]{130}';
  cardanoSignatureFormat = '[a-f0-9]{582}';

  allSignatureFormat = `${this.masterKeySignatureFormat}|${this.hashSignatureFormat}|${this.bitcoinSignatureFormat}|${this.lightningSignatureFormat}|${this.lightningCustodialSignatureFormat}|${this.moneroSignatureFormat}|${this.ethereumSignatureFormat}|${this.cardanoSignatureFormat}`;

  formats = {
    address: new RegExp(`^(${this.allAddressFormat})$`),
    signature: new RegExp(`^(${this.allSignatureFormat})$`),
    key: /^[a-f0-9]{84}$/,
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
    requestTimeout: 30000,
  };

  i18n: I18nOptions = {
    fallbackLanguage: this.defaultLanguage,
    loaderOptions: {
      path: join(__dirname, '../shared/i18n/'),
      watch: true,
    },
    resolvers: [{ resolve: () => this.defaultLanguage }],
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
    gatewayHost: process.env.KYC_GATEWAY_HOST,
    auto: { customer: process.env.KYC_CUSTOMER_AUTO, apiKey: process.env.KYC_API_KEY_AUTO },
    video: { customer: process.env.KYC_CUSTOMER_VIDEO, apiKey: process.env.KYC_API_KEY_VIDEO },
    transactionPrefix: process.env.KYC_TRANSACTION_PREFIX,
    identFailAfterDays: 90,
    allowedWebhookIps: process.env.KYC_WEBHOOK_IPS?.split(','),
    reminderAfterDays: 2,
  };

  support = {
    limitRequest: {
      mailName: process.env.LIMIT_REQUEST_SUPPORT_NAME,
      mailAddress: process.env.LIMIT_REQUEST_SUPPORT_MAIL,
      mailBanner: process.env.LIMIT_REQUEST_SUPPORT_BANNER,
    },
    blackSquad: {
      link: process.env.BS_LINK,
      limit: 50000, // CHF
      mailName: process.env.BLACK_SQUAD_NAME,
      mailAddress: process.env.BLACK_SQUAD_MAIL,
      mailBanner: process.env.BLACK_SQUAD_BANNER,
    },
  };

  letter = {
    auth: { username: process.env.LETTER_USER, apikey: process.env.LETTER_AUTH },
    url: process.env.LETTER_URL,
  };

  frontend = {
    payment: process.env.PAYMENT_URL,
    services: process.env.SERVICES_URL,
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
        dir: join(__dirname, '../subdomains/supporting/notification/templates'),
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

  whale = {
    version: 'v0',
    network: this.network,
    urls: process.env.OCEAN_URLS?.split(','),
  };

  transaction = {
    pricing: {
      refreshRate: 15, // minutes
      coinGeckoApiKey: process.env.COIN_GECKO_API_KEY,
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
      minimalPreparationFee: 0.00000001,

      walletAccount: (accountIndex: number): WalletAccount => ({
        seed: this.blockchain.evm.depositSeed,
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
    },
    optimism: {
      optimismWalletAddress: process.env.OPTIMISM_WALLET_ADDRESS,
      optimismWalletPrivateKey: process.env.OPTIMISM_WALLET_PRIVATE_KEY,
      optimismGatewayUrl: process.env.OPTIMISM_GATEWAY_URL,
      optimismApiKey: process.env.ALCHEMY_API_KEY,
      optimismChainId: +process.env.OPTIMISM_CHAIN_ID,
      swapContractAddress: process.env.OPTIMISM_SWAP_CONTRACT_ADDRESS,
    },
    arbitrum: {
      arbitrumWalletAddress: process.env.ARBITRUM_WALLET_ADDRESS,
      arbitrumWalletPrivateKey: process.env.ARBITRUM_WALLET_PRIVATE_KEY,
      arbitrumGatewayUrl: process.env.ARBITRUM_GATEWAY_URL,
      arbitrumApiKey: process.env.ALCHEMY_API_KEY,
      arbitrumChainId: +process.env.ARBITRUM_CHAIN_ID,
      swapContractAddress: process.env.ARBITRUM_SWAP_CONTRACT_ADDRESS,
    },
    polygon: {
      polygonWalletAddress: process.env.POLYGON_WALLET_ADDRESS,
      polygonWalletPrivateKey: process.env.POLYGON_WALLET_PRIVATE_KEY,
      polygonGatewayUrl: process.env.POLYGON_GATEWAY_URL,
      polygonApiKey: process.env.ALCHEMY_API_KEY,
      polygonChainId: +process.env.POLYGON_CHAIN_ID,
      swapContractAddress: process.env.POLYGON_SWAP_CONTRACT_ADDRESS,
    },
    base: {
      baseWalletAddress: process.env.BASE_WALLET_ADDRESS,
      baseWalletPrivateKey: process.env.BASE_WALLET_PRIVATE_KEY,
      baseGatewayUrl: process.env.BASE_GATEWAY_URL,
      baseApiKey: process.env.ALCHEMY_API_KEY,
      baseChainId: +process.env.BASE_CHAIN_ID,
      swapContractAddress: process.env.BASE_SWAP_CONTRACT_ADDRESS,
    },
    bsc: {
      bscScanApiUrl: process.env.BSC_SCAN_API_URL,
      bscScanApiKey: process.env.BSC_SCAN_API_KEY,
      bscWalletAddress: process.env.BSC_WALLET_ADDRESS,
      bscWalletPrivateKey: process.env.BSC_WALLET_PRIVATE_KEY,
      bscGatewayUrl: process.env.BSC_GATEWAY_URL,
      bscChainId: +process.env.BSC_CHAIN_ID,
      swapContractAddress: process.env.BSC_SWAP_CONTRACT_ADDRESS,
    },
    lightning: {
      lnbits: {
        apiKey: process.env.LIGHTNING_LNBITS_API_KEY,
        apiUrl: process.env.LIGHTNING_LNBITS_API_URL,
        lnurlpApiUrl: process.env.LIGHTNING_LNBITS_LNURLP_API_URL,
        lnurlpUrl: process.env.LIGHTNING_LNBITS_LNURLP_URL,
        lnurlwApiUrl: process.env.LIGHTNING_LNBITS_LNURLW_API_URL,
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
    frankencoin: {
      zchfGatewayUrl: process.env.ZCHF_GATEWAY_URL,
      zchfApiKey: process.env.ALCHEMY_API_KEY,
      zchfGraphUrl: process.env.ZCHF_GRAPH_URL,
      contractAddress: {
        zchf: process.env.ZCHF_CONTRACT_ADDRESS,
        equity: process.env.ZCHF_EQUITY_CONTRACT_ADDRESS,
        stablecoinBridge: process.env.ZCHF_STABLECOIN_BRIDGE_CONTRACT_ADDRESS,
        xchf: process.env.ZCHF_XCHF_CONTRACT_ADDRESS,
      },
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
    forwardFeeLimit: +(process.env.PAY_IN_FEE_LIMIT ?? 0.001),
  };

  buy = {
    fee: {
      limit: +(process.env.BUY_CRYPTO_FEE_LIMIT ?? 0.001),
    },
  };

  exchange: ExchangeConfig = {
    enableRateLimit: true,
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
    revolut: {
      refreshToken: process.env.REVOLUT_REFRESH_TOKEN,
      clientAssertion: process.env.REVOLUT_CLIENT_ASSERTION,
    },
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

  request = {
    knownIps: process.env.REQUEST_KNOWN_IPS?.split(',') ?? [],
    limitCheck: process.env.REQUEST_LIMIT_CHECK === 'true',
  };

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
