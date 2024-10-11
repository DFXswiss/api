import { Config } from 'src/config/config';
import { Active } from 'src/shared/models/active';
import { Country } from 'src/shared/models/country/country.entity';
import { Util } from 'src/shared/utils/util';
import { BankData } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { KycLevel, KycType, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User, UserStatus } from 'src/subdomains/generic/user/models/user/user.entity';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { FiatPaymentMethod, PaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import {
  SpecialExternalAccount,
  SpecialExternalAccountType,
} from 'src/subdomains/supporting/payment/entities/special-external-account.entity';
import { BuyCrypto } from '../../buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from '../../sell-crypto/process/buy-fiat.entity';
import { AmlError, AmlErrorResult, AmlErrorType } from '../enums/aml-error.enum';
import { AmlReason } from '../enums/aml-reason.enum';
import { AmlRule } from '../enums/aml-rule.enum';
import { CheckStatus } from '../enums/check-status.enum';

export class AmlHelperService {
  static getAmlErrors(
    entity: BuyCrypto | BuyFiat,
    inputAsset: Active,
    minVolume: number,
    last24hVolume: number,
    last7dCheckoutVolume: number,
    last30dVolume: number,
    last365dVolume: number,
    bankData: BankData,
    blacklist: SpecialExternalAccount[],
    banks?: Bank[],
    ibanCountry?: Country,
  ): AmlError[] {
    const errors = [];

    if (entity.inputReferenceAmount < minVolume * 0.9) errors.push(AmlError.MIN_VOLUME_NOT_REACHED);
    if (entity.user.isBlocked) errors.push(AmlError.USER_BLOCKED);
    if (entity.user.isDeleted) errors.push(AmlError.USER_DELETED);
    if (entity.userData.isBlocked) errors.push(AmlError.USER_DATA_BLOCKED);
    if (entity.userData.isDeactivated) errors.push(AmlError.USER_DATA_DEACTIVATED);
    if (!entity.userData.isPaymentStatusEnabled) errors.push(AmlError.INVALID_USER_DATA_STATUS);
    if (!entity.userData.isPaymentKycStatusEnabled) errors.push(AmlError.INVALID_KYC_STATUS);
    if (entity.userData.kycType !== KycType.DFX) errors.push(AmlError.INVALID_KYC_TYPE);
    if (!entity.userData.verifiedName) errors.push(AmlError.NO_VERIFIED_NAME);
    if (entity.userData.verifiedCountry && !entity.userData.verifiedCountry.fatfEnable) {
      errors.push(AmlError.VERIFIED_COUNTRY_NOT_ALLOWED);
    }
    if (ibanCountry && !ibanCountry.fatfEnable) errors.push(AmlError.IBAN_COUNTRY_FATF_NOT_ALLOWED);
    if (!entity.userData.hasValidNameCheckDate)
      errors.push(entity.userData.birthday ? AmlError.NAME_CHECK_WITH_BIRTHDAY : AmlError.NAME_CHECK_WITHOUT_KYC);
    if (blacklist.some((b) => b.matches([SpecialExternalAccountType.BANNED_MAIL], entity.userData.mail)))
      errors.push(AmlError.SUSPICIOUS_MAIL);
    if (last30dVolume > Config.tradingLimits.monthlyDefault) errors.push(AmlError.MONTHLY_LIMIT_REACHED);
    if (entity.userData.kycLevel < KycLevel.LEVEL_50 && last365dVolume > Config.tradingLimits.yearlyWithoutKyc)
      errors.push(AmlError.YEARLY_LIMIT_WO_KYC_REACHED);
    if (last24hVolume > Config.tradingLimits.dailyDefault) {
      // KYC required
      if (entity.userData.kycLevel < KycLevel.LEVEL_50) errors.push(AmlError.KYC_LEVEL_TOO_LOW);
      if (!entity.userData.hasBankTxVerification) errors.push(AmlError.NO_BANK_TX_VERIFICATION);
      if (!entity.userData.letterSentDate) errors.push(AmlError.NO_LETTER);
      if (!entity.userData.amlListAddedDate) errors.push(AmlError.NO_AML_LIST);
      if (!entity.userData.kycFileId) errors.push(AmlError.NO_KYC_FILE_ID);
      if (last365dVolume > entity.userData.depositLimit) errors.push(AmlError.DEPOSIT_LIMIT_REACHED);
    }

    // AmlRule asset/fiat check
    errors.push(this.amlRuleCheck(inputAsset.amlRule, entity, last7dCheckoutVolume));
    errors.push(this.amlRuleCheck(entity.outputAsset.amlRule, entity, last7dCheckoutVolume));

    if (entity instanceof BuyFiat || !entity.cryptoInput) {
      if (!bankData || bankData.approved === null) {
        errors.push(AmlError.BANK_DATA_MISSING);
      } else if ((!bankData.approved && !bankData.manualApproved) || bankData.manualApproved === false) {
        errors.push(AmlError.BANK_DATA_NOT_ACTIVE);
      } else if (entity.userData.id !== bankData.userData.id) {
        errors.push(AmlError.BANK_DATA_USER_MISMATCH);
      }
    }

    if (entity.cryptoInput) {
      // crypto input
      if (!entity.cryptoInput.isConfirmed) errors.push(AmlError.INPUT_NOT_CONFIRMED);
      if (entity.inputAsset === 'XMR' && entity.userData.kycLevel < KycLevel.LEVEL_30)
        errors.push(AmlError.KYC_LEVEL_FOR_ASSET_NOT_REACHED);
    }

    if (entity instanceof BuyCrypto) {
      // buyCrypto
      if (!entity.outputAsset.buyable) errors.push(AmlError.ASSET_NOT_BUYABLE);

      if (
        entity.userData.hasSuspiciousMail &&
        entity.user.wallet.amlRule !== AmlRule.RULE_5 &&
        entity.userData.status === UserDataStatus.NA &&
        (entity.checkoutTx || (entity.bankTx && entity.userData.kycLevel < KycLevel.LEVEL_30))
      )
        errors.push(AmlError.SUSPICIOUS_MAIL);

      errors.push(this.amlRuleCheck(entity.user.wallet.amlRule, entity, last7dCheckoutVolume));

      if (entity.bankTx) {
        // bank
        if (
          blacklist.some((b) =>
            b.matches(
              [
                SpecialExternalAccountType.BANNED_BIC,
                SpecialExternalAccountType.BANNED_BIC_BUY,
                SpecialExternalAccountType.BANNED_BIC_AML,
              ],
              entity.bankTx.bic,
            ),
          )
        )
          errors.push(AmlError.BIC_BLACKLISTED);
        if (
          blacklist.some((b) =>
            b.matches(
              [
                SpecialExternalAccountType.BANNED_IBAN,
                SpecialExternalAccountType.BANNED_IBAN_BUY,
                SpecialExternalAccountType.BANNED_IBAN_AML,
              ],
              entity.bankTx.iban,
            ),
          )
        )
          errors.push(AmlError.IBAN_BLACKLISTED);

        if (
          blacklist.some((b) => b.matches([SpecialExternalAccountType.BANNED_ACCOUNT_IBAN], entity.bankTx.accountIban))
        )
          errors.push(AmlError.ACCOUNT_IBAN_BLACKLISTED);

        const bank = banks.find((b) => b.iban === entity.bankTx.accountIban);
        if (bank?.sctInst && !entity.userData.olkypayAllowed) errors.push(AmlError.INSTANT_NOT_ALLOWED);
        if (bank?.sctInst && !entity.outputAsset.instantBuyable) errors.push(AmlError.ASSET_NOT_INSTANT_BUYABLE);
        if (bank && !bank.receive) errors.push(AmlError.BANK_DEACTIVATED);
      } else if (entity.checkoutTx) {
        // checkout
        if (
          !bankData.manualApproved &&
          entity.checkoutTx.cardName &&
          !Util.isSameName(entity.checkoutTx.cardName, entity.userData.verifiedName)
        )
          errors.push(AmlError.CARD_NAME_MISMATCH);
        if (!entity.outputAsset.cardBuyable) errors.push(AmlError.ASSET_NOT_CARD_BUYABLE);
        if (ibanCountry && !ibanCountry.checkoutEnable) errors.push(AmlError.CHECKOUT_COUNTRY_NOT_ALLOWED);
        if (
          blacklist.some((b) =>
            b.matches(
              [
                SpecialExternalAccountType.BANNED_IBAN,
                SpecialExternalAccountType.BANNED_IBAN_BUY,
                SpecialExternalAccountType.BANNED_IBAN_AML,
              ],
              entity.checkoutTx.cardFingerPrint,
            ),
          )
        )
          errors.push(AmlError.CARD_BLACKLISTED);
        if (last7dCheckoutVolume > Config.tradingLimits.weeklyAmlRule) errors.push(AmlError.WEEKLY_LIMIT_REACHED);
      } else {
        // swap
        if (entity.userData.status !== UserDataStatus.ACTIVE && entity.userData.kycLevel < KycLevel.LEVEL_30) {
          errors.push(AmlError.KYC_LEVEL_TOO_LOW);
        }
      }
    } else {
      // buyFiat
      if (entity.sell.fiat.name === 'CHF' && !entity.sell.iban.startsWith('CH') && !entity.sell.iban.startsWith('LI'))
        errors.push(AmlError.ABROAD_CHF_NOT_ALLOWED);
      if (!entity.sell.fiat.sellable) errors.push(AmlError.ASSET_NOT_SELLABLE);
      if (
        blacklist.some((b) =>
          b.matches(
            [
              SpecialExternalAccountType.BANNED_IBAN,
              SpecialExternalAccountType.BANNED_IBAN_SELL,
              SpecialExternalAccountType.BANNED_IBAN_AML,
            ],
            entity.sell.iban,
          ),
        )
      )
        errors.push(AmlError.IBAN_BLACKLISTED);
    }

    return errors;
  }

  static amlRuleCheck(
    amlRule: AmlRule,
    entity: BuyCrypto | BuyFiat,
    last7dCheckoutVolume: number,
  ): AmlError | undefined {
    switch (amlRule) {
      case AmlRule.DEFAULT:
        return undefined;

      case AmlRule.RULE_1:
        if (
          entity instanceof BuyCrypto &&
          entity.checkoutTx &&
          entity.user.status === UserStatus.NA &&
          entity.checkoutTx.ip !== entity.user.ip
        )
          return AmlError.IP_MISMATCH;
        break;

      case AmlRule.RULE_2:
        if (entity.user.status === UserStatus.NA && entity.userData.kycLevel < KycLevel.LEVEL_30)
          return AmlError.KYC_LEVEL_30_NOT_REACHED;
        break;

      case AmlRule.RULE_3:
        if (entity.user.status === UserStatus.NA && entity.userData.kycLevel < KycLevel.LEVEL_50)
          return AmlError.KYC_LEVEL_50_NOT_REACHED;
        break;

      case AmlRule.RULE_4:
        if (last7dCheckoutVolume > Config.tradingLimits.weeklyAmlRule) return AmlError.WEEKLY_LIMIT_REACHED;
        break;

      case AmlRule.RULE_6:
        if (
          entity.user.status === UserStatus.NA &&
          entity instanceof BuyCrypto &&
          entity.checkoutTx &&
          entity.userData.kycLevel < KycLevel.LEVEL_30
        )
          return AmlError.KYC_LEVEL_30_NOT_REACHED;
        break;

      case AmlRule.RULE_7:
        if (
          entity.user.status === UserStatus.NA &&
          entity instanceof BuyCrypto &&
          entity.checkoutTx &&
          entity.userData.kycLevel < KycLevel.LEVEL_50
        )
          return AmlError.KYC_LEVEL_50_NOT_REACHED;
        break;
    }

    return undefined;
  }

  static amlRuleUserCheck(amlRules: AmlRule[], user: User, paymentMethodIn: PaymentMethod): boolean {
    return (
      user?.status === UserStatus.NA &&
      ((amlRules.includes(AmlRule.RULE_2) && user?.userData.kycLevel < KycLevel.LEVEL_30) ||
        (amlRules.includes(AmlRule.RULE_3) && user?.userData.kycLevel < KycLevel.LEVEL_50) ||
        (amlRules.includes(AmlRule.RULE_6) &&
          paymentMethodIn === FiatPaymentMethod.CARD &&
          user?.userData.kycLevel < KycLevel.LEVEL_30) ||
        (amlRules.includes(AmlRule.RULE_7) &&
          paymentMethodIn === FiatPaymentMethod.CARD &&
          user?.userData.kycLevel < KycLevel.LEVEL_50))
    );
  }

  static getAmlResult(
    entity: BuyCrypto | BuyFiat,
    inputAsset: Active,
    minVolume: number,
    last24hVolume: number,
    last7dCheckoutVolume: number,
    last30dVolume: number,
    last365dVolume: number,
    bankData: BankData,
    blacklist: SpecialExternalAccount[],
    banks?: Bank[],
    ibanCountry?: Country,
  ): {
    bankData?: BankData;
    amlCheck?: CheckStatus;
    amlReason?: AmlReason;
    comment?: string;
    amlResponsible?: string;
    priceDefinitionAllowedDate?: Date;
  } {
    const amlErrors = this.getAmlErrors(
      entity,
      inputAsset,
      minVolume,
      last24hVolume,
      last7dCheckoutVolume,
      last30dVolume,
      last365dVolume,
      bankData,
      blacklist,
      banks,
      ibanCountry,
    ).filter((e) => e);

    const comment = amlErrors.join(';');

    // Pass
    if (amlErrors.length === 0)
      return {
        bankData,
        amlCheck: CheckStatus.PASS,
        amlReason: AmlReason.NA,
        amlResponsible: 'API',
        priceDefinitionAllowedDate: new Date(),
      };

    const amlResults = amlErrors.map((amlError) => ({ amlError, ...AmlErrorResult[amlError] }));

    // Expired pending amlChecks
    if (entity.amlCheck === CheckStatus.PENDING) {
      if (Util.daysDiff(entity.created) > 2) return { amlCheck: CheckStatus.FAIL, amlResponsible: 'API' };
      if (amlResults.some((e) => e.amlReason === AmlReason.MANUAL_CHECK)) return {};
    }

    // Crucial error aml
    const crucialErrorResults = amlResults.filter((r) => r.type === AmlErrorType.CRUCIAL);
    if (crucialErrorResults.length) {
      const crucialErrorResult =
        crucialErrorResults.find((c) => c.amlCheck === CheckStatus.FAIL) ?? crucialErrorResults[0];
      return Util.minutesDiff(entity.created) >= 10
        ? {
            bankData,
            amlCheck: crucialErrorResult.amlCheck,
            amlReason: crucialErrorResult.amlReason,
            comment,
            amlResponsible: 'API',
          }
        : { bankData, comment };
    }

    // Only error aml
    const onlyErrorResult = amlResults.find((r) => r.type === AmlErrorType.SINGLE);
    if (onlyErrorResult && amlErrors.length === 1)
      return { bankData, amlCheck: onlyErrorResult.amlCheck, amlReason: onlyErrorResult.amlReason, comment };

    // Same error aml
    if (
      amlResults.every((r) => r.type === AmlErrorType.MULTI) &&
      (amlResults.every((r) => r.amlCheck === CheckStatus.PENDING) ||
        amlResults.every((r) => r.amlCheck === CheckStatus.FAIL))
    )
      return {
        bankData,
        amlCheck: amlResults[0].amlCheck,
        amlReason: amlResults[0].amlReason,
        comment,
        amlResponsible: 'API',
      };

    // GSheet
    if (Util.minutesDiff(entity.created) >= 10 && entity.amlCheck !== CheckStatus.PENDING)
      return { bankData, amlCheck: CheckStatus.GSHEET, comment };

    // No Result - only comment
    return { bankData, comment };
  }
}
