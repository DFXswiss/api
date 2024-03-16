import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { KycLevel, KycType } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.entity';
import { AmlRule } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { SpecialExternalBankAccount } from 'src/subdomains/supporting/bank/special-external-bank-account/special-external-bank-account.entity';
import { BuyCrypto } from '../buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from '../sell-crypto/process/buy-fiat.entity';
import { CheckStatus } from './enums/check-status.enum';

@Injectable()
export class AmlService {
  constructor() {}

  static getAmlErrors(
    entity: BuyCrypto | BuyFiat,
    minVolume: number,
    amountInChf: number,
    last24hVolume: number,
    last30dVolume: number,
    bankDataUserDataId: number,
    blacklist: SpecialExternalBankAccount[],
    instantBanks: Bank[],
  ): string[] {
    const errors = [];

    if (entity.inputReferenceAmount < minVolume * 0.9) errors.push('MinVolumeNotReached');
    if (!entity.target.asset.buyable) errors.push('AssetNotBuyable');
    if (!entity.user.isPaymentStatusEnabled) errors.push('InvalidUserStatus');
    if (!entity.userData.isPaymentStatusEnabled) errors.push('InvalidUserDataStatus');
    if (!entity.userData.isPaymentKycStatusEnabled) errors.push('InvalidKycStatus');
    if (entity.userData.kycType !== KycType.DFX) errors.push('InvalidKycType');
    if (!entity.userData.verifiedName) errors.push('NoVerifiedName');
    if (!entity.userData.verifiedCountry) errors.push('NoVerifiedCountry');
    if (!entity.userData.lastNameCheckDate) errors.push('NoNameCheck');
    if (Util.daysDiff(entity.userData.lastNameCheckDate) > Config.amlCheckLastNameCheckValidity)
      errors.push('OutdatedNameCheck');
    if (last30dVolume > Config.tradingLimits.monthlyDefault) errors.push('MonthlyLimitReached');
    if (last24hVolume > Config.tradingLimits.dailyDefault) {
      // KYC required
      if (entity.userData.kycLevel < KycLevel.LEVEL_50) errors.push('KycLevelTooLow');
      if (!entity.userData.hasBankTxVerification) errors.push('NoBankTxVerification');
      if (!entity.userData.letterSentDate) errors.push('NoLetter');
      if (!entity.userData.amlListAddedDate) errors.push('NoAmlList');
      if (!entity.userData.kycFileId) errors.push('NoKycFileId');
      if (entity.userData.annualBuyVolume + amountInChf > entity.userData.depositLimit)
        errors.push('DepositLimitReached');
    }

    if (entity instanceof BuyCrypto) {
      switch (entity.user.wallet.amlRule) {
        case AmlRule.DEFAULT:
          break;
        case AmlRule.RULE_1:
          if (entity.checkoutTx && entity.user.status === UserStatus.NA && entity.checkoutTx.ip !== entity.user.ip)
            errors.push('IpMismatch');
          break;
        case AmlRule.RULE_2:
          if (entity.userData.kycLevel < KycLevel.LEVEL_30) errors.push('KycLevel30NotReached');
          break;
        case AmlRule.RULE_3:
          if (entity.userData.kycLevel < KycLevel.LEVEL_50) errors.push('KycLevel50NotReached');
          break;
      }

      if (!entity.cryptoInput) {
        if (!bankDataUserDataId) {
          errors.push('BankDataMissing');
        } else if (entity.userData.id !== bankDataUserDataId) {
          errors.push('BankDataUserMismatch');
        }
        if (entity.user.status === UserStatus.NA && entity.userData.hasSuspiciousMail) errors.push('SuspiciousMail');
      }

      if (entity.bankTx) {
        // bank
        if (blacklist.some((b) => b.bic && b.bic === entity.bankTx.bic)) errors.push('BicBlacklisted');
        if (blacklist.some((b) => b.iban && b.iban === entity.bankTx.iban)) errors.push('IbanBlacklisted');
        if (instantBanks.some((b) => b.iban === entity.bankTx.accountIban)) {
          if (!entity.userData.olkypayAllowed) errors.push('InstantNotAllowed');
          if (!entity.target.asset.instantBuyable) errors.push('AssetNotInstantBuyable');
        }
      } else if (entity.checkoutTx) {
        // checkout
        if (!entity.target.asset.cardBuyable) errors.push('AssetNotCardBuyable');
        if (blacklist.some((b) => b.iban && b.iban === entity.checkoutTx.cardFingerPrint))
          errors.push('CardBlacklisted');
      } else {
        // crypto input
        if (entity.cryptoInput.amlCheck !== CheckStatus.PASS) errors.push('InputAmlFailed');
        if (!entity.cryptoInput.isConfirmed) errors.push('InputNotConfirmed');
        if (!entity.userData.cryptoCryptoAllowed) errors.push('CryptoNotAllowed');
      }
    }

    return errors;
  }
}
