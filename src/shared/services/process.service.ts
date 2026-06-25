import { Injectable, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { SettingService } from '../models/setting/setting.service';
import { DfxCron } from '../utils/cron';

export enum Process {
  PAY_OUT = 'PayOut',
  PAY_IN = 'PayIn',
  FIAT_PAY_IN = 'FiatPayIn',
  BUY_FIAT = 'BuyFiat',
  BUY_CRYPTO = 'BuyCrypto',
  BUY_CRYPTO_AGGREGATION = 'BuyCryptoAggregation',
  LIMIT_REQUEST_MAIL = 'LimitRequestMail',
  BLACK_SQUAD_MAIL = 'BlackSquadMail',
  PAY_IN_MAIL = 'PayInMail',
  BUY_CRYPTO_MAIL = 'BuyCryptoMail',
  BUY_FIAT_MAIL = 'BuyFiatMail',
  REF_REWARD_MAIL = 'RefRewardMail',
  EXCHANGE_TX_SYNC = 'ExchangeTxSync',
  LIQUIDITY_MANAGEMENT = 'LiquidityManagement',
  LIQUIDITY_MANAGEMENT_CHECK_BALANCES = 'LiquidityManagementCheckBalances',
  MONITORING = 'Monitoring',
  MONITOR_CONNECTION_POOL = 'MonitorConnectionPool',
  UPDATE_STATISTIC = 'UpdateStatistic',
  UPDATE_REALUNIT_STATS = 'UpdateRealunitStats',
  KYC = 'Kyc',
  KYC_IDENT_REVIEW = 'KycIdentReview',
  KYC_NATIONALITY_REVIEW = 'KycNationalityReview',
  KYC_FINANCIAL_REVIEW = 'KycFinancialReview',
  KYC_RECOMMENDATION_REVIEW = 'KycRecommendationReview',
  KYC_MAIL = 'KycMail',
  BANK_ACCOUNT = 'BankAccount',
  BANK_TX = 'BankTx',
  STAKING = 'Staking',
  REF_PAYOUT = 'RefPayout',
  PRICING = 'Pricing',
  AUTO_AML_CHECK = 'AutoAmlCheck',
  BANK_RELEASE_CHECK = 'BankReleaseCheck',
  BUY_CRYPTO_REFRESH_FEE = 'BuyCryptoRefreshFee',
  BUY_FIAT_SET_FEE = 'BuyFiatSetFee',
  LNURL_AUTH_CACHE = 'LnurlAuthCache',
  TFA_CACHE = '2faCache',
  FRANKENCOIN_LOG_INFO = 'FrankencoinLogInfo',
  DEURO_LOG_INFO = 'DEuroLogInfo',
  JUICE_LOG_INFO = 'JuiceLogInfo',
  WEBHOOK = 'Webhook',
  AUTO_CREATE_BANK_DATA = 'AutoCreateBankData',
  TX_SPEEDUP = 'TxSpeedup',
  MAIL_RETRY = 'MailRetry',
  TRADING = 'Trading',
  TX_MAIL = 'TxMail',
  TX_UNASSIGNED_MAIL = 'TxUnassignedMail',
  BANK_DATA_VERIFICATION = 'BankDataVerification',
  SUPPORT_MESSAGE_MAIL = 'SupportMessageMail',
  NETWORK_START_FEE = 'NetworkStartFee',
  TRADING_LOG = 'TradingLog',
  ASSET_DECIMALS = 'AssetDecimals',
  UPDATE_BLOCKCHAIN_FEE = 'UpdateBlockchainFee',
  SANCTION_SYNC = 'SanctionSync',
  PAYMENT_EXPIRATION = 'PaymentExpiration',
  PAYMENT_CONFIRMATIONS = 'PaymentConfirmations',
  PAYMENT_FORWARDING = 'PaymentForwarding',
  FIAT_OUTPUT = 'FiatOutput',
  FIAT_OUTPUT_ASSIGN_BANK_ACCOUNT = 'FiatOutputAssignBankAccount',
  FIAT_OUTPUT_READY_DATE = 'FiatOutputReadyDate',
  FIAT_OUTPUT_BATCH_ID_UPDATE = 'FiatOutputBatchIdUpdate',
  FIAT_OUTPUT_BATCH_ID_UPDATE_JOB = 'FiatOutputBatchIdUpdateJob',
  FIAT_OUTPUT_TRANSMISSION_CHECK = 'FiatOutputTransmissionCheck',
  FIAT_OUTPUT_BANK_TX_SEARCH = 'FiatOutputBankTxSearch',
  FIAT_OUTPUT_YAPEAL_TRANSMISSION = 'FiatOutputYapealTransmission',
  FIAT_OUTPUT_YAPEAL_STATUS_CHECK = 'FiatOutputYapealStatusCheck',
  FIAT_OUTPUT_OLKYPAY_TRANSMISSION = 'FiatOutputOlkypayTransmission',
  FIAT_OUTPUT_OLKYPAY_STATUS_CHECK = 'FiatOutputOlkypayStatusCheck',
  BLOCKCHAIN_FEE_UPDATE = 'BlockchainFeeUpdate',
  TX_REQUEST = 'TxRequest',
  TX_REQUEST_WAITING_EXPIRY = 'TxRequestWaitingExpiry',
  ORGANIZATION_SYNC = 'OrganizationSync',
  BANK_TX_RETURN = 'BankTxReturn',
  BANK_TX_RETURN_MAIL = 'BankTxReturnMail',
  CUSTODY = 'Custody',
  EXCHANGE_WITHDRAWAL = 'ExchangeWithdrawal',
  EXCHANGE_TRADE = 'ExchangeTrade',
  CRYPTO_PAYOUT = 'CryptoPayout',
  USER_DATA = 'UserData',
  USER = 'User',
  LOG_CLEANUP = 'LogCleanup',
  SAFETY_MODE = 'SafetyMode',
  BINANCE_PAY_CERTIFICATES_UPDATE = 'BinancePayCertificatesUpdate',
  AML_RECHECK_MAIL_RESET = 'AmlRecheckMailReset',
  ZANO_ASSET_WHITELIST = 'ZanoAssetWhitelist',
  TRADE_APPROVAL_DATE = 'TradeApprovalDate',
  SUPPORT_BOT = 'SupportBot',
  GUARANTEED_PRICE = 'GuaranteedPrice',
  GS_DEBUG = 'GsDebug',
  GS_DB = 'GsDb',
}

const safetyProcesses: Process[] = [
  Process.EXCHANGE_WITHDRAWAL,
  Process.EXCHANGE_TRADE,
  Process.FIAT_OUTPUT_BATCH_ID_UPDATE,
  Process.CRYPTO_PAYOUT,
  Process.LIQUIDITY_MANAGEMENT,
  Process.TRADING,
];

type ProcessMap = { [p in Process]?: boolean };

let DisabledProcesses: ProcessMap = undefined;

export function DisabledProcess(process: Process): boolean {
  return !DisabledProcesses || DisabledProcesses[process] === true;
}

// JWT address denylist. A leaked or compromised wallet address can be added to the
// `jwtAddressDenylist` setting (lowercase, JSON string[]) and active JWTs for that address are
// rejected within one refresh interval (~30s) — no JWT-secret rotation, no API redeploy. Setting
// user.status = BLOCKED alone does NOT revoke active JWTs because UserActiveGuard reads status
// from the JWT payload, not the DB. Lookup is sync (in-memory Set) to keep JwtStrategy.validate
// off the DB hot path; refreshed by ProcessService alongside the disabled-process map.
let DeniedJwtAddresses: Set<string> = new Set();

export function IsJwtAddressDenied(address: string | undefined): boolean {
  return !!address && DeniedJwtAddresses.has(address.toLowerCase());
}

@Injectable()
export class ProcessService implements OnModuleInit {
  private safetyModeInactive = true;

  constructor(private readonly settingService: SettingService) {}

  async onModuleInit(): Promise<void> {
    void this.resyncDisabledProcesses();
    // await so the JWT denylist is primed before HTTP starts — `IsJwtAddressDenied` defaults to
    // false on an empty Set (fail-open), unlike DisabledProcess which is fail-closed by sentinel
    await this.resyncDeniedJwtAddresses();
  }

  @DfxCron(CronExpression.EVERY_30_SECONDS, { timeout: 1800 })
  async resyncDisabledProcesses(): Promise<void> {
    const allDisabledProcesses = [
      ...(await this.settingService.getDisabledProcesses()),
      ...Config.disabledProcesses(),
      ...(this.safetyModeInactive ? [] : safetyProcesses),
    ];
    DisabledProcesses = this.listToMap(allDisabledProcesses);
  }

  @DfxCron(CronExpression.EVERY_30_SECONDS, { timeout: 1800 })
  async resyncDeniedJwtAddresses(): Promise<void> {
    const list = await this.settingService.getDeniedJwtAddresses();
    DeniedJwtAddresses = new Set(list.map((a) => a.toLowerCase()));
  }

  public async setSafetyModeActive(active: boolean): Promise<void> {
    this.safetyModeInactive = DisabledProcess(Process.SAFETY_MODE) ? true : !active;
    await this.resyncDisabledProcesses();
  }

  public isSafetyModeActive(): boolean {
    return !this.safetyModeInactive;
  }

  private listToMap(processes: Process[]): ProcessMap {
    return processes.reduce((map, p) => {
      map[p] = true;
      return map;
    }, {});
  }
}
