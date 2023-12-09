import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
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
  BANK_ACCOUNT = 'BankAccount',
  BANK_TX = 'BankTx',
  STAKING = 'Staking',
  REF_PAYOUT = 'RefPayout',
  PRICING = 'Pricing',
  BUY_CRYPTO_AML_CHECK = 'BuyCryptoAmlCheck',
  BUY_CRYPTO_SET_FEE = 'BuyCryptoSetFee',
  LNURL_AUTH_CACHE = 'LnurlAuthCache',
  BUY_FIAT_SET_FEE = 'BuyFiatSetFee',
}

@Injectable()
export class ProcessService {
  constructor(private readonly settingService: SettingService) {}

  async isDisableProcess(process: Process): Promise<boolean> {
    const disabledProcesses = await this.settingService.isDisableProcess(process);
    return disabledProcesses || Config.processDisabled(process);
  }
}
