import { Config, Environment } from 'src/config/config';
import { Active } from 'src/shared/models/active';
import { Country } from 'src/shared/models/country/country.entity';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Util } from 'src/shared/utils/util';
import { ReviewStatus } from 'src/subdomains/generic/kyc/enums/review-status.enum';
import { BankData, BankDataVerificationError } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { KycLevel, KycType, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.enum';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { VirtualIban } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.entity';
import { FiatPaymentMethod, PaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';
import {
  SpecialExternalAccount,
  SpecialExternalAccountType,
} from 'src/subdomains/supporting/payment/entities/special-external-account.entity';
import { BuyCrypto } from '../../buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from '../../sell-crypto/process/buy-fiat.entity';
import { AmlError, AmlErrorResult, AmlErrorType, DelayResultError } from '../enums/aml-error.enum';
import { AmlReason, KycAmlReasons, RecheckAmlReasons } from '../enums/aml-reason.enum';
import { AmlRule, SpecialIpCountries } from '../enums/aml-rule.enum';
import { CheckStatus } from '../enums/check-status.enum';

export class AmlHelperService {
  static getAmlErrors(
    entity: BuyCrypto | BuyFiat,
    inputAsset: Active,
    minVolume: number,
    amountInChf: number,
    last7dCheckoutVolume: number,
    last30dVolume: number,
    last365dVolume: number,
    bankData: BankData,
    blacklist: SpecialExternalAccount[],
    banks?: Bank[],
    ibanCountry?: Country,
    refUser?: User,
    ipLogCountries?: string[],
    virtualIban?: VirtualIban,
    multiAccountBankNames?: string[],
  ): AmlError[] {
    const errors: AmlError[] = [];
    const nationality = entity.userData.nationality;

    if (
      entity.wallet.amlRuleList.includes(AmlRule.SKIP_AML_CHECK) &&
      [Environment.LOC, Environment.DEV].includes(Config.environment)
    )
      return errors;

    if (
      !DisabledProcess(Process.TRADE_APPROVAL_DATE) &&
      !entity.userData.tradeApprovalDate &&
      !entity.wallet.autoTradeApproval
    )
      errors.push(AmlError.TRADE_APPROVAL_DATE_MISSING);
    if (entity.inputReferenceAmount < minVolume * 0.9) errors.push(AmlError.MIN_VOLUME_NOT_REACHED);
    if (entity.user.isBlocked) errors.push(AmlError.USER_BLOCKED);
    if (entity.user.isDeleted) errors.push(AmlError.USER_DELETED);
    if (entity.userData.isBlocked || entity.userData.isRiskBlocked) errors.push(AmlError.USER_DATA_BLOCKED);
    if (entity.userData.isDeactivated) errors.push(AmlError.USER_DATA_DEACTIVATED);
    if (!entity.userData.isPaymentStatusEnabled) errors.push(AmlError.INVALID_USER_DATA_STATUS);
    if (!entity.userData.isPaymentKycStatusEnabled) errors.push(AmlError.INVALID_KYC_STATUS);
    if (refUser && !refUser.userData.isPaymentKycStatusEnabled) errors.push(AmlError.INVALID_KYC_STATUS_REF_USER);
    if (entity.userData.kycType !== KycType.DFX) errors.push(AmlError.INVALID_KYC_TYPE);
    if (!entity.userData.verifiedName) errors.push(AmlError.NO_VERIFIED_NAME);
    if (!entity.userData.verifiedName && !bankData?.name && !entity.userData.completeName)
      errors.push(AmlError.NAME_MISSING);
    if (entity.userData.verifiedCountry && !entity.userData.verifiedCountry.fatfEnable)
      errors.push(AmlError.VERIFIED_COUNTRY_NOT_ALLOWED);
    if (ibanCountry && !ibanCountry.fatfEnable) errors.push(AmlError.IBAN_COUNTRY_FATF_NOT_ALLOWED);
    if (!entity.userData.hasValidNameCheckDate)
      errors.push(entity.userData.birthday ? AmlError.NAME_CHECK_WITH_BIRTHDAY : AmlError.NAME_CHECK_WITHOUT_KYC);
    if (blacklist.some((b) => b.matches([SpecialExternalAccountType.BANNED_MAIL], entity.userData.mail)))
      errors.push(AmlError.SUSPICIOUS_MAIL);
    if (last30dVolume > Config.tradingLimits.monthlyDefault) errors.push(AmlError.MONTHLY_LIMIT_REACHED);
    if (entity.userData.kycLevel < KycLevel.LEVEL_50 && last365dVolume > Config.tradingLimits.yearlyWithoutKyc)
      errors.push(AmlError.YEARLY_LIMIT_WO_KYC_REACHED);
    if (entity.userData.hasIpRisk && !entity.userData.phoneCallIpCheckDate) {
      if (entity.userData.kycLevel >= KycLevel.LEVEL_50) {
        errors.push(AmlError.IP_PHONE_VERIFICATION_NEEDED);
      } else {
        errors.push(AmlError.IP_BLACKLISTED_WITHOUT_KYC);
      }
    }
    if (last30dVolume > Config.tradingLimits.monthlyDefaultWoKyc) {
      // KYC required
      if (entity.userData.kycLevel < KycLevel.LEVEL_50) errors.push(AmlError.KYC_LEVEL_TOO_LOW);
      if (!entity.userData.hasBankTxVerification) errors.push(AmlError.NO_BANK_TX_VERIFICATION);
      if (entity.userData.accountType !== AccountType.ORGANIZATION && !entity.userData.letterSentDate)
        errors.push(AmlError.NO_LETTER);
      if (last365dVolume > entity.userData.depositLimit) errors.push(AmlError.DEPOSIT_LIMIT_REACHED);
    }

    // AmlRule asset/fiat check
    errors.push(
      ...this.amlRuleCheck(
        inputAsset.amlRuleFrom,
        entity.wallet.exceptAmlRuleList,
        entity,
        amountInChf,
        last7dCheckoutVolume,
      ),
    );
    errors.push(
      ...this.amlRuleCheck(
        entity.outputAsset.amlRuleTo,
        entity.wallet.exceptAmlRuleList,
        entity,
        amountInChf,
        last7dCheckoutVolume,
      ),
    );
    if (ibanCountry)
      errors.push(
        ...this.amlRuleCheck(
          ibanCountry.amlRule,
          entity.wallet.exceptAmlRuleList,
          entity,
          amountInChf,
          last7dCheckoutVolume,
        ),
      );
    if (entity.userData.nationality)
      errors.push(
        ...this.amlRuleCheck(
          entity.userData.nationality.amlRule,
          entity.wallet.exceptAmlRuleList,
          entity,
          amountInChf,
          last7dCheckoutVolume,
        ),
      );
    for (const amlRule of entity.wallet.amlRuleList) {
      const error = this.amlRuleCheck(
        amlRule,
        entity.wallet.exceptAmlRuleList,
        entity,
        amountInChf,
        last7dCheckoutVolume,
      );
      if (
        !entity.wallet.amlRuleList.includes(AmlRule.RULE_11) ||
        (!error.includes(AmlError.KYC_LEVEL_30_NOT_REACHED) && !error.includes(AmlError.KYC_LEVEL_50_NOT_REACHED))
      )
        errors.push(...error);
    }

    if (!entity.outputAsset.buyable) errors.push(AmlError.ASSET_NOT_BUYABLE);

    if (entity instanceof BuyFiat || !entity.cryptoInput) {
      if (!bankData || (bankData.approved === null && !bankData.isInReview)) {
        errors.push(AmlError.BANK_DATA_MISSING);
      } else if (!bankData.isReviewed && bankData.mergeError) {
        if (bankData.mergeError === BankDataVerificationError.MERGE_PENDING) errors.push(AmlError.MERGE_PENDING);
        if (bankData.mergeError === BankDataVerificationError.MERGE_EXPIRED) errors.push(AmlError.MERGE_EXPIRED);
      } else if (bankData.status === ReviewStatus.MANUAL_REVIEW) {
        errors.push(AmlError.BANK_DATA_MANUAL_REVIEW);
      } else if ((!bankData.approved && !bankData.manualApproved) || bankData.manualApproved === false) {
        errors.push(AmlError.BANK_DATA_NOT_ACTIVE);
      } else if (entity.userData.id !== bankData.userData.id) {
        errors.push(AmlError.BANK_DATA_USER_MISMATCH);
      }
    }

    if (entity.cryptoInput) {
      // crypto input
      if (!inputAsset.sellable && !entity.cryptoInput.asset.paymentEnabled) errors.push(AmlError.ASSET_NOT_SELLABLE);
      if (!entity.cryptoInput.isConfirmed) errors.push(AmlError.INPUT_NOT_CONFIRMED);
      if (entity.inputAsset === 'XMR' && entity.userData.kycLevel < KycLevel.LEVEL_30)
        errors.push(AmlError.KYC_LEVEL_FOR_ASSET_NOT_REACHED);
    }

    if (entity instanceof BuyCrypto) {
      // buyCrypto
      if (entity.userData.isRiskBuyCryptoBlocked) errors.push(AmlError.USER_DATA_BLOCKED);
      if (
        !entity.cryptoInput &&
        entity.userData.country &&
        !entity.userData.phoneCallIpCountryCheckDate &&
        ipLogCountries.some(
          (l) =>
            l !== entity.userData.country.symbol &&
            ![l, entity.userData.country.symbol].every((c) => Config.allowedBorderRegions.includes(c)),
        )
      )
        errors.push(AmlError.IP_COUNTRY_MISMATCH);

      if (
        entity.userData.hasSuspiciousMail &&
        !entity.user.wallet.amlRuleList.includes(AmlRule.RULE_5) &&
        entity.userData.status === UserDataStatus.NA &&
        (entity.checkoutTx || (entity.bankTx && entity.userData.kycLevel < KycLevel.LEVEL_30))
      )
        errors.push(AmlError.SUSPICIOUS_MAIL);

      for (const amlRule of entity.user.wallet.amlRuleList) {
        errors.push(
          ...this.amlRuleCheck(amlRule, entity.wallet.exceptAmlRuleList, entity, amountInChf, last7dCheckoutVolume),
        );
      }

      if (
        !entity.userData.phoneCallCheckDate &&
        !entity.userData.phoneVerificationExempt &&
        !entity.user.wallet.amlRuleList.includes(AmlRule.RULE_14) &&
        (entity.bankTx || entity.checkoutTx) &&
        entity.userData.phone &&
        entity.userData.birthday &&
        (!entity.userData.accountType || entity.userData.accountType === AccountType.PERSONAL) &&
        Util.yearsDiff(entity.userData.birthday) > 55
      )
        errors.push(AmlError.PHONE_VERIFICATION_NEEDED);

      if (entity.bankTx) {
        // bank
        if (nationality && !nationality.bankEnable) errors.push(AmlError.TX_COUNTRY_NOT_ALLOWED);

        // Check for intermediary banks without sender name
        if (multiAccountBankNames?.some((bank) => entity.bankTx.name === bank) && !entity.bankTx.ultimateName)
          errors.push(AmlError.BANK_TX_CUSTOMER_NAME_MISSING);
        if (!DisabledProcess(Process.BANK_RELEASE_CHECK) && !entity.bankTx.bankReleaseDate)
          errors.push(AmlError.BANK_RELEASE_DATE_MISSING);

        // virtual IBAN user check
        if (virtualIban && virtualIban.userData.id !== entity.userData.id) {
          errors.push(AmlError.VIRTUAL_IBAN_USER_MISMATCH);
        }

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
        if (bank && !bank.amlEnabled) errors.push(AmlError.BANK_DEACTIVATED);
      } else if (entity.checkoutTx) {
        // checkout
        if (nationality && !nationality.checkoutEnable) errors.push(AmlError.TX_COUNTRY_NOT_ALLOWED);
        if (
          !bankData.manualApproved &&
          entity.checkoutTx.cardName &&
          !Util.isSameName(entity.checkoutTx.cardName, entity.userData.verifiedName)
        )
          errors.push(AmlError.CARD_NAME_MISMATCH);
        if (!entity.outputAsset.cardBuyable) errors.push(AmlError.ASSET_NOT_CARD_BUYABLE);
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
        if (entity.inputAmount > entity.cryptoInput.asset.liquidityCapacity)
          errors.push(AmlError.LIQUIDITY_LIMIT_EXCEEDED);
        if (nationality && !nationality.cryptoEnable) errors.push(AmlError.TX_COUNTRY_NOT_ALLOWED);
        if (entity.userData.status !== UserDataStatus.ACTIVE && entity.userData.kycLevel < KycLevel.LEVEL_30) {
          errors.push(AmlError.KYC_LEVEL_TOO_LOW);
        }
      }
    } else {
      // buyFiat
      if (entity.userData.isRiskBuyFiatBlocked) errors.push(AmlError.USER_DATA_BLOCKED);
      if (entity.inputAmount > entity.cryptoInput.asset.liquidityCapacity)
        errors.push(AmlError.LIQUIDITY_LIMIT_EXCEEDED);
      if (nationality && !nationality.cryptoEnable) errors.push(AmlError.TX_COUNTRY_NOT_ALLOWED);
      if (entity.sell.fiat.name === 'CHF' && !entity.sell.iban.startsWith('CH') && !entity.sell.iban.startsWith('LI'))
        errors.push(AmlError.ABROAD_CHF_NOT_ALLOWED);
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
      if (!entity.sell.fiat.isIbanCountryAllowed(ibanCountry.symbol)) errors.push(AmlError.IBAN_CURRENCY_MISMATCH);
    }

    return errors;
  }

  static amlRuleCheck(
    amlRule: AmlRule,
    exceptAmlRules: AmlRule[],
    entity: BuyCrypto | BuyFiat,
    amountInChf: number,
    last7dCheckoutVolume: number,
  ): AmlError[] {
    if (exceptAmlRules.includes(amlRule)) return [];

    const errors: AmlError[] = [];

    switch (amlRule) {
      case AmlRule.DEFAULT:
        return [];

      case AmlRule.RULE_1:
        if (
          entity instanceof BuyCrypto &&
          entity.checkoutTx &&
          entity.user.status === UserStatus.NA &&
          entity.checkoutTx.ip !== entity.user.ip
        )
          errors.push(AmlError.IP_MISMATCH);
        break;

      case AmlRule.RULE_2:
        if (entity.user.status === UserStatus.NA && entity.userData.kycLevel < KycLevel.LEVEL_30)
          return [AmlError.KYC_LEVEL_30_NOT_REACHED];
        break;

      case AmlRule.RULE_3:
        if (entity.user.status === UserStatus.NA && entity.userData.kycLevel < KycLevel.LEVEL_50)
          errors.push(AmlError.KYC_LEVEL_50_NOT_REACHED);
        break;

      case AmlRule.RULE_4:
        if (
          last7dCheckoutVolume > Config.tradingLimits.weeklyAmlRule &&
          entity instanceof BuyCrypto &&
          entity.checkoutTx
        )
          errors.push(AmlError.WEEKLY_LIMIT_REACHED);
        break;

      case AmlRule.RULE_6:
        if (
          entity.user.status === UserStatus.NA &&
          entity instanceof BuyCrypto &&
          entity.checkoutTx &&
          entity.userData.kycLevel < KycLevel.LEVEL_30
        )
          errors.push(AmlError.KYC_LEVEL_30_NOT_REACHED);
        break;

      case AmlRule.RULE_7:
        if (
          entity.user.status === UserStatus.NA &&
          entity instanceof BuyCrypto &&
          entity.checkoutTx &&
          entity.userData.kycLevel < KycLevel.LEVEL_50
        )
          errors.push(AmlError.KYC_LEVEL_50_NOT_REACHED);
        break;

      case AmlRule.RULE_8:
        if (amountInChf > 100000) errors.push(AmlError.ASSET_AMOUNT_TOO_HIGH);
        break;

      case AmlRule.RULE_9:
        if (entity instanceof BuyCrypto && entity.checkoutTx) {
          if (entity.user.status !== UserStatus.ACTIVE) errors.push(AmlError.USER_NOT_ACTIVE);
          if (entity.userData.kycLevel < KycLevel.LEVEL_30) errors.push(AmlError.KYC_LEVEL_30_NOT_REACHED);
        }

        break;

      case AmlRule.RULE_10:
        if (entity instanceof BuyCrypto && entity.checkoutTx) {
          if (entity.user.status !== UserStatus.ACTIVE) errors.push(AmlError.USER_NOT_ACTIVE);
          if (entity.userData.kycLevel < KycLevel.LEVEL_50) errors.push(AmlError.KYC_LEVEL_50_NOT_REACHED);
        }

        break;

      case AmlRule.RULE_12:
        if (entity instanceof BuyCrypto && entity.checkoutTx) {
          if (!entity.userData.hasBankTx) errors.push(AmlError.NO_BANK_TX_VERIFICATION);
          if (entity.userData.kycLevel < KycLevel.LEVEL_30) errors.push(AmlError.KYC_LEVEL_30_NOT_REACHED);
        }
        break;

      case AmlRule.RULE_13:
        if (entity instanceof BuyCrypto && entity.checkoutTx) {
          if (!entity.userData.hasBankTx) errors.push(AmlError.NO_BANK_TX_VERIFICATION);
          if (entity.userData.kycLevel < KycLevel.LEVEL_50) errors.push(AmlError.KYC_LEVEL_50_NOT_REACHED);
        }

        break;
    }

    return errors;
  }

  static amlRuleQuoteCheck(
    amlRules: AmlRule[],
    exceptAmlRules: AmlRule[],
    user: User,
    paymentMethodIn: PaymentMethod,
  ): QuoteError | undefined {
    if (!user) return undefined;
    if (amlRules.includes(AmlRule.RULE_11) && SpecialIpCountries.includes(user.ipCountry)) return undefined;

    if (exceptAmlRules?.length) amlRules = amlRules.filter((a) => !exceptAmlRules.includes(a));

    if (
      amlRules.includes(AmlRule.RULE_2) &&
      user.status === UserStatus.NA &&
      user.userData.kycLevel < KycLevel.LEVEL_30
    )
      return QuoteError.KYC_REQUIRED;

    if (
      amlRules.includes(AmlRule.RULE_3) &&
      user.status === UserStatus.NA &&
      user.userData.kycLevel < KycLevel.LEVEL_50
    )
      return QuoteError.KYC_REQUIRED;

    if (
      amlRules.includes(AmlRule.RULE_6) &&
      paymentMethodIn === FiatPaymentMethod.CARD &&
      user.status === UserStatus.NA &&
      user.userData.kycLevel < KycLevel.LEVEL_30
    )
      return QuoteError.KYC_REQUIRED;

    if (
      amlRules.includes(AmlRule.RULE_7) &&
      paymentMethodIn === FiatPaymentMethod.CARD &&
      user.status === UserStatus.NA &&
      user.userData.kycLevel < KycLevel.LEVEL_50
    )
      return QuoteError.KYC_REQUIRED;

    if (amlRules.includes(AmlRule.RULE_9) && paymentMethodIn === FiatPaymentMethod.CARD) {
      if (user.status !== UserStatus.ACTIVE) return QuoteError.BANK_TRANSACTION_OR_VIDEO_MISSING;
      if (user.userData.kycLevel < KycLevel.LEVEL_30) return QuoteError.KYC_REQUIRED;
    }

    if (amlRules.includes(AmlRule.RULE_10) && paymentMethodIn === FiatPaymentMethod.CARD) {
      if (user.status !== UserStatus.ACTIVE) return QuoteError.BANK_TRANSACTION_OR_VIDEO_MISSING;
      if (user.userData.kycLevel < KycLevel.LEVEL_50) return QuoteError.KYC_REQUIRED;
    }

    if (amlRules.includes(AmlRule.RULE_12) && paymentMethodIn === FiatPaymentMethod.CARD) {
      if (!user.userData.hasBankTx) return QuoteError.BANK_TRANSACTION_MISSING;
      if (user.userData.kycLevel < KycLevel.LEVEL_30) return QuoteError.KYC_REQUIRED;
    }

    if (amlRules.includes(AmlRule.RULE_13) && paymentMethodIn === FiatPaymentMethod.CARD) {
      if (!user.userData.hasBankTx) return QuoteError.BANK_TRANSACTION_MISSING;
      if (user.userData.kycLevel < KycLevel.LEVEL_50) return QuoteError.KYC_REQUIRED;
    }
  }

  static getAmlResult(
    entity: BuyCrypto | BuyFiat,
    inputAsset: Active,
    minVolume: number,
    amountInChf: number,
    last7dCheckoutVolume: number,
    last30dVolume: number,
    last365dVolume: number,
    bankData: BankData,
    blacklist: SpecialExternalAccount[],
    ibanCountry?: Country,
    refUser?: User,
    banks?: Bank[],
    ipLogCountries?: string[],
    virtualIban?: VirtualIban,
    multiAccountBankNames?: string[],
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
      amountInChf,
      last7dCheckoutVolume,
      last30dVolume,
      last365dVolume,
      bankData,
      blacklist,
      banks,
      ibanCountry,
      refUser,
      ipLogCountries,
      virtualIban,
      multiAccountBankNames,
    ).filter((e) => e);

    const comment = Array.from(new Set(amlErrors)).join(';');

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
      if (Util.daysDiff(entity.created) > 14) return { amlCheck: CheckStatus.FAIL, amlResponsible: 'API' };
      if (
        !RecheckAmlReasons.includes(entity.amlReason) ||
        comment === entity.comment ||
        (KycAmlReasons.includes(entity.amlReason) && entity.userData.kycLevel < KycLevel.LEVEL_50)
      )
        return {};
    }

    // Delay amlCheck for some specific errors
    if (amlErrors.some((e) => DelayResultError.includes(e)) && Util.minutesDiff(entity.created) < 5) return { comment };

    // Crucial error aml
    const crucialErrorResults = amlResults.filter((r) => r.type === AmlErrorType.CRUCIAL);
    if (crucialErrorResults.length) {
      const crucialErrorResult =
        crucialErrorResults.find((c) => c.amlCheck === CheckStatus.FAIL) ??
        crucialErrorResults.find((c) => c.amlCheck === CheckStatus.GSHEET) ??
        crucialErrorResults.find((c) => c.amlCheck === CheckStatus.PENDING) ??
        crucialErrorResults[0];
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
        amlResults.every((r) => r.amlCheck === CheckStatus.FAIL) ||
        amlResults.every((r) => r.amlCheck === CheckStatus.GSHEET))
    )
      return {
        bankData,
        amlCheck: amlResults[0].amlCheck,
        amlReason: amlResults[0].amlReason,
        comment,
        amlResponsible: 'API',
      };

    // GSheet
    if (Util.minutesDiff(entity.created) >= 10) return { bankData, amlCheck: CheckStatus.GSHEET, comment };

    // No Result - only comment
    return { bankData, comment };
  }
}
