import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Lock } from 'src/shared/utils/lock';
import { SettingService } from '../models/setting/setting.service';

export enum Process {
  PAY_OUT = 'PayOut',
  PAY_IN = 'PayIn',
  FIAT_PAY_IN = 'FiatPayIn',
  BUY_FIAT = 'BuyFiat',
  BUY_CRYPTO = 'BuyCrypto',
  LIMIT_REQUEST_MAIL = 'LimitRequestMail',
  BLACK_SQUAD_MAIL = 'BlackSquadMail',
  PAY_IN_MAIL = 'PayInMail',
  BUY_CRYPTO_MAIL = 'BuyCryptoMail',
  BUY_FIAT_MAIL = 'BuyFiatMail',
  REF_REWARD_MAIL = 'RefRewardMail',
  EXCHANGE_TX_SYNC = 'ExchangeTxSync',
  LIQUIDITY_MANAGEMENT = 'LiquidityManagement',
  MONITORING = 'Monitoring',
  UPDATE_CFP = 'UpdateCfp',
  UPDATE_STATISTIC = 'UpdateStatistic',
  KYC = 'Kyc',
  KYC_MAIL = 'KycMail',
  BANK_ACCOUNT = 'BankAccount',
  BANK_TX = 'BankTx',
  STAKING = 'Staking',
  REF_PAYOUT = 'RefPayout',
  PRICING = 'Pricing',
  BUY_CRYPTO_AML_CHECK = 'BuyCryptoAmlCheck',
  BUY_CRYPTO_SET_FEE = 'BuyCryptoSetFee',
  BUY_FIAT_SET_FEE = 'BuyFiatSetFee',
  LNURL_AUTH_CACHE = 'LnurlAuthCache',
  TFA_CACHE = '2faCache',
}

type ProcessMap = { [p in Process]?: boolean };

let DisabledProcesses: ProcessMap = {};

export function DisabledProcess(process: Process): boolean {
  return DisabledProcesses[process] === true;
}

@Injectable()
export class ProcessService implements OnModuleInit {
  constructor(private readonly settingService: SettingService) {}

  onModuleInit() {
    DisabledProcesses = this.listToMap(Config.disabledProcesses());

    void this.resyncDisabledProcesses();
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  @Lock(1800)
  async resyncDisabledProcesses(): Promise<void> {
    const allDisabledProcesses = [...(await this.settingService.getDisabledProcesses()), ...Config.disabledProcesses()];
    DisabledProcesses = this.listToMap(allDisabledProcesses);
  }

  private listToMap(processes: Process[]): ProcessMap {
    return processes.reduce((map, p) => {
      map[p] = true;
      return map;
    }, {});
  }
}
