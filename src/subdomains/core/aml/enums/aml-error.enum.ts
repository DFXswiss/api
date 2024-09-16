import { AmlReason } from './aml-reason.enum';
import { CheckStatus } from './check-status.enum';

export enum AmlError {
  MIN_VOLUME_NOT_REACHED = 'MinVolumeNotReached',
  KYC_LEVEL_30_NOT_REACHED = 'KycLevel30NotReached',
  KYC_LEVEL_50_NOT_REACHED = 'KycLevel50NotReached',
  KYC_LEVEL_TOO_LOW = 'KycLevelTooLow',
  KYC_LEVEL_FOR_ASSET_NOT_REACHED = 'KycLevelForAssetNotReached',
  ASSET_NOT_SELLABLE = 'AssetNotSellable',
  ASSET_NOT_BUYABLE = 'AssetNotBuyable',
  ASSET_NOT_INSTANT_BUYABLE = 'AssetNotInstantBuyable',
  ASSET_NOT_CARD_BUYABLE = 'AssetNotCardBuyable',
  INSTANT_NOT_ALLOWED = 'InstantNotAllowed',
  CRYPTO_CRYPTO_NOT_ALLOWED = 'CryptoCryptoNotAllowed',
  ABROAD_CHF_NOT_ALLOWED = 'AbroadChfNotAllowed',
  USER_BLOCKED = 'UserBlocked',
  USER_DELETED = 'UserDeleted',
  USER_DATA_BLOCKED = 'UserDataBlocked',
  USER_DATA_DEACTIVATED = 'UserDataDeactivated',
  INVALID_USER_DATA_STATUS = 'InvalidUserDataStatus',
  INVALID_KYC_STATUS = 'InvalidKycStatus',
  INVALID_KYC_TYPE = 'InvalidKycType',
  NO_VERIFIED_NAME = 'NoVerifiedName',
  VERIFIED_COUNTRY_NOT_ALLOWED = 'VerifiedCountryNotAllowed',
  IBAN_COUNTRY_FATF_NOT_ALLOWED = 'IbanCountryFatfNotAllowed',
  CHECKOUT_COUNTRY_NOT_ALLOWED = 'CheckoutCountryNotAllowed',
  NO_BANK_TX_VERIFICATION = 'NoBankTxVerification',
  NO_LETTER = 'NoLetter',
  NO_AML_LIST = 'NoAmlList',
  NO_KYC_FILE_ID = 'NoKycFileId',
  NAME_CHECK_WITHOUT_KYC = 'NameCheckWithoutKYC',
  NAME_CHECK_WITH_BIRTHDAY = 'NameCheckWithBirthday',
  WEEKLY_LIMIT_REACHED = 'WeeklyLimitReached',
  MONTHLY_LIMIT_REACHED = 'MonthlyLimitReached',
  YEARLY_LIMIT_WO_KYC_REACHED = 'YearlyLimitWoKycReached',
  DEPOSIT_LIMIT_REACHED = 'DepositLimitReached',
  BANK_DATA_MISSING = 'BankDataMissing',
  BANK_DATA_NOT_ACTIVE = 'BankDataNotActive',
  BANK_DATA_USER_MISMATCH = 'BankDataUserMismatch',
  BIC_BLACKLISTED = 'BicBlacklisted',
  IBAN_BLACKLISTED = 'IbanBlacklisted',
  CARD_BLACKLISTED = 'CardBlacklisted',
  INPUT_NOT_CONFIRMED = 'InputNotConfirmed',
  IP_MISMATCH = 'IpMismatch',
  SUSPICIOUS_MAIL = 'SuspiciousMail',
  CARD_NAME_MISMATCH = 'CardNameMismatch',
}

export enum AmlErrorType {
  SINGLE = 'Single', // Only one error may occur
  MULTI = 'Multi', // All errors must have the same amlCheck
  CRUCIAL = 'Crucial', // Prioritized error
}

export const AmlErrorResult: {
  [b in AmlError]: { type: AmlErrorType; amlCheck: CheckStatus; amlReason: AmlReason };
} = {
  [AmlError.MIN_VOLUME_NOT_REACHED]: null,
  [AmlError.KYC_LEVEL_30_NOT_REACHED]: null,
  [AmlError.KYC_LEVEL_50_NOT_REACHED]: null,
  [AmlError.KYC_LEVEL_TOO_LOW]: null,
  [AmlError.KYC_LEVEL_FOR_ASSET_NOT_REACHED]: {
    type: AmlErrorType.CRUCIAL,
    amlCheck: CheckStatus.PENDING,
    amlReason: AmlReason.ASSET_KYC_NEEDED,
  },
  [AmlError.ASSET_NOT_SELLABLE]: null,
  [AmlError.ASSET_NOT_BUYABLE]: {
    type: AmlErrorType.CRUCIAL,
    amlCheck: CheckStatus.FAIL,
    amlReason: AmlReason.ASSET_CURRENTLY_NOT_AVAILABLE,
  },
  [AmlError.ASSET_NOT_INSTANT_BUYABLE]: {
    type: AmlErrorType.CRUCIAL,
    amlCheck: CheckStatus.FAIL,
    amlReason: AmlReason.ASSET_NOT_AVAILABLE_WITH_CHOSEN_BANK,
  },
  [AmlError.ASSET_NOT_CARD_BUYABLE]: null,
  [AmlError.INSTANT_NOT_ALLOWED]: {
    type: AmlErrorType.MULTI,
    amlCheck: CheckStatus.PENDING,
    amlReason: AmlReason.OLKY_NO_KYC,
  },
  [AmlError.CRYPTO_CRYPTO_NOT_ALLOWED]: null,
  [AmlError.ABROAD_CHF_NOT_ALLOWED]: {
    type: AmlErrorType.CRUCIAL,
    amlCheck: CheckStatus.FAIL,
    amlReason: AmlReason.CHF_ABROAD_TX,
  },
  [AmlError.USER_BLOCKED]: {
    type: AmlErrorType.CRUCIAL,
    amlCheck: CheckStatus.FAIL,
    amlReason: AmlReason.USER_BLOCKED,
  },
  [AmlError.USER_DELETED]: {
    type: AmlErrorType.CRUCIAL,
    amlCheck: CheckStatus.FAIL,
    amlReason: AmlReason.USER_DELETED,
  },
  [AmlError.USER_DATA_BLOCKED]: {
    type: AmlErrorType.CRUCIAL,
    amlCheck: CheckStatus.FAIL,
    amlReason: AmlReason.USER_DATA_BLOCKED,
  },
  [AmlError.USER_DATA_DEACTIVATED]: null,
  [AmlError.INVALID_USER_DATA_STATUS]: null,
  [AmlError.INVALID_KYC_STATUS]: null,
  [AmlError.INVALID_KYC_TYPE]: null,
  [AmlError.NO_VERIFIED_NAME]: null,
  [AmlError.VERIFIED_COUNTRY_NOT_ALLOWED]: {
    type: AmlErrorType.CRUCIAL,
    amlCheck: CheckStatus.FAIL,
    amlReason: AmlReason.COUNTRY_NOT_ALLOWED,
  },
  [AmlError.IBAN_COUNTRY_FATF_NOT_ALLOWED]: {
    type: AmlErrorType.CRUCIAL,
    amlCheck: CheckStatus.FAIL,
    amlReason: AmlReason.COUNTRY_NOT_ALLOWED,
  },
  [AmlError.CHECKOUT_COUNTRY_NOT_ALLOWED]: {
    type: AmlErrorType.CRUCIAL,
    amlCheck: CheckStatus.FAIL,
    amlReason: AmlReason.COUNTRY_NOT_ALLOWED,
  },
  [AmlError.NO_BANK_TX_VERIFICATION]: null,
  [AmlError.NO_LETTER]: null,
  [AmlError.NO_AML_LIST]: null,
  [AmlError.NO_KYC_FILE_ID]: null,
  [AmlError.NAME_CHECK_WITHOUT_KYC]: {
    type: AmlErrorType.MULTI,
    amlCheck: CheckStatus.PENDING,
    amlReason: AmlReason.NAME_CHECK_WITHOUT_KYC,
  },
  [AmlError.NAME_CHECK_WITH_BIRTHDAY]: {
    type: AmlErrorType.MULTI,
    amlCheck: CheckStatus.GSHEET,
    amlReason: null,
  },
  [AmlError.WEEKLY_LIMIT_REACHED]: {
    type: AmlErrorType.MULTI,
    amlCheck: CheckStatus.GSHEET,
    amlReason: null,
  },
  [AmlError.MONTHLY_LIMIT_REACHED]: null,
  [AmlError.YEARLY_LIMIT_WO_KYC_REACHED]: {
    type: AmlErrorType.CRUCIAL,
    amlCheck: CheckStatus.PENDING,
    amlReason: AmlReason.ANNUAL_LIMIT_WITHOUT_KYC,
  },
  [AmlError.DEPOSIT_LIMIT_REACHED]: {
    type: AmlErrorType.SINGLE,
    amlCheck: CheckStatus.PENDING,
    amlReason: AmlReason.ANNUAL_LIMIT,
  },
  [AmlError.BANK_DATA_MISSING]: null,
  [AmlError.BANK_DATA_NOT_ACTIVE]: {
    type: AmlErrorType.CRUCIAL,
    amlCheck: CheckStatus.GSHEET,
    amlReason: null,
  },
  [AmlError.BANK_DATA_USER_MISMATCH]: null,
  [AmlError.BIC_BLACKLISTED]: null,
  [AmlError.IBAN_BLACKLISTED]: null,
  [AmlError.CARD_BLACKLISTED]: null,
  [AmlError.CARD_NAME_MISMATCH]: {
    type: AmlErrorType.CRUCIAL,
    amlCheck: CheckStatus.FAIL,
    amlReason: AmlReason.CARD_NAME_MISMATCH,
  },
  [AmlError.INPUT_NOT_CONFIRMED]: null,
  [AmlError.IP_MISMATCH]: {
    type: AmlErrorType.MULTI,
    amlCheck: CheckStatus.GSHEET,
    amlReason: null,
  },
  [AmlError.SUSPICIOUS_MAIL]: {
    type: AmlErrorType.MULTI,
    amlCheck: CheckStatus.GSHEET,
    amlReason: null,
  },
};
