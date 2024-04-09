import { AmlReason } from './aml-reason.enum';
import { CheckStatus } from './check-status.enum';

export enum AmlError {
  MIN_VOLUME_NOT_REACHED = 'MinVolumeNotReached',
  KYC_LEVEL_30_NOT_REACHED = 'KycLevel30NotReached',
  KYC_LEVEL_50_NOT_REACHED = 'KycLevel50NotReached',
  KYC_LEVEL_TOO_LOW = 'KycLevelTooLow',
  ASSET_NOT_SELLABLE = 'AssetNotSellable',
  ASSET_NOT_BUYABLE = 'AssetNotBuyable',
  ASSET_NOT_INSTANT_BUYABLE = 'AssetNotInstantBuyable',
  ASSET_NOT_CARD_BUYABLE = 'AssetNotCardBuyable',
  INSTANT_NOT_ALLOWED = 'InstantNotAllowed',
  CRYPTO_CRYPTO_NOT_ALLOWED = 'CryptoNotAllowed',
  INVALID_USER_STATUS = 'InvalidUserStatus',
  INVALID_USER_DATA_STATUS = 'InvalidUserDataStatus',
  INVALID_KYC_STATUS = 'InvalidKycStatus',
  INVALID_KYC_TYPE = 'InvalidKycType',
  NO_VERIFIED_NAME = 'NoVerifiedName',
  NO_VERIFIED_COUNTRY = 'NoVerifiedCountry',
  NO_BANK_TX_VERIFICATION = 'NoBankTxVerification',
  NO_LETTER = 'NoLetter',
  NO_AML_LIST = 'NoAmlList',
  NO_KYC_FILE_ID = 'NoKycFileId',
  NAME_CHECK_WITHOUT_KYC = 'NameCheckWithoutKYC',
  NAME_CHECK_WITH_BIRTHDAY = 'NameCheckWithBirthday',
  WEEKLY_LIMIT_REACHED = 'WeeklyLimitReached',
  MONTHLY_LIMIT_REACHED = 'MonthlyLimitReached',
  DEPOSIT_LIMIT_REACHED = 'DepositLimitReached',
  BANK_DATA_MISSING = 'BankDataMissing',
  BANK_DATA_NOT_ACTIVE = 'BankDataNotActive',
  BANK_DATA_USER_MISMATCH = 'BankDataUserMismatch',
  BIC_BLACKLISTED = 'BicBlacklisted',
  IBAN_BLACKLISTED = 'IbanBlacklisted',
  CARD_BLACKLISTED = 'CardBlacklisted',
  INPUT_AML_CHECK_FAILED = 'InputAmlFailed',
  INPUT_NOT_CONFIRMED = 'InputNotConfirmed',
  IP_MISMATCH = 'IpMismatch',
  SUSPICIOUS_MAIL = 'SuspiciousMail',
}

export enum AmlErrorType {
  SINGLE = 'Single', // Only one error may occur
  MULTI = 'Multi', // All errors must have the same amlCheck
  CRUCIAL = 'Crucial', // Prioritized error
}

export const AmlErrorResult: {
  [b in AmlError]: { type: AmlErrorType; amlCheck: CheckStatus; amlReason: AmlReason };
} = {
  [AmlError.ASSET_NOT_BUYABLE]: null,
  [AmlError.MIN_VOLUME_NOT_REACHED]: null,
  [AmlError.KYC_LEVEL_30_NOT_REACHED]: null,
  [AmlError.KYC_LEVEL_50_NOT_REACHED]: null,
  [AmlError.KYC_LEVEL_TOO_LOW]: null,
  [AmlError.ASSET_NOT_SELLABLE]: null,
  [AmlError.ASSET_NOT_INSTANT_BUYABLE]: null,
  [AmlError.ASSET_NOT_CARD_BUYABLE]: null,
  [AmlError.INSTANT_NOT_ALLOWED]: null,
  [AmlError.CRYPTO_CRYPTO_NOT_ALLOWED]: null,
  [AmlError.INVALID_USER_STATUS]: null,
  [AmlError.INVALID_USER_DATA_STATUS]: null,
  [AmlError.INVALID_KYC_STATUS]: null,
  [AmlError.INVALID_KYC_TYPE]: null,
  [AmlError.NO_VERIFIED_NAME]: null,
  [AmlError.NO_VERIFIED_COUNTRY]: null,
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
    amlCheck: CheckStatus.PENDING,
    amlReason: AmlReason.MANUAL_CHECK,
  },
  [AmlError.WEEKLY_LIMIT_REACHED]: {
    type: AmlErrorType.MULTI,
    amlCheck: CheckStatus.PENDING,
    amlReason: AmlReason.MANUAL_CHECK,
  },
  [AmlError.MONTHLY_LIMIT_REACHED]: null,
  [AmlError.DEPOSIT_LIMIT_REACHED]: {
    type: AmlErrorType.SINGLE,
    amlCheck: CheckStatus.PENDING,
    amlReason: AmlReason.ANNUAL_LIMIT,
  },
  [AmlError.BANK_DATA_MISSING]: null,
  [AmlError.BANK_DATA_NOT_ACTIVE]: {
    type: AmlErrorType.CRUCIAL,
    amlCheck: CheckStatus.FAIL,
    amlReason: AmlReason.IBAN_CHECK,
  },
  [AmlError.BANK_DATA_USER_MISMATCH]: null,
  [AmlError.BIC_BLACKLISTED]: null,
  [AmlError.IBAN_BLACKLISTED]: null,
  [AmlError.CARD_BLACKLISTED]: null,
  [AmlError.INPUT_AML_CHECK_FAILED]: null,
  [AmlError.INPUT_NOT_CONFIRMED]: null,
  [AmlError.IP_MISMATCH]: {
    type: AmlErrorType.MULTI,
    amlCheck: CheckStatus.PENDING,
    amlReason: AmlReason.MANUAL_CHECK,
  },
  [AmlError.SUSPICIOUS_MAIL]: {
    type: AmlErrorType.MULTI,
    amlCheck: CheckStatus.PENDING,
    amlReason: AmlReason.MANUAL_CHECK,
  },
};
