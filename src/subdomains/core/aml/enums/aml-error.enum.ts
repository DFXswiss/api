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
  NO_NAME_CHECK = 'NoNameCheck',
  OUTDATED_NAME_CHECK = 'OutdatedNameCheck',
  MONTHLY_LIMIT_REACHED = 'MonthlyLimitReached',
  DEPOSIT_LIMIT_REACHED = 'DepositLimitReached',
  BANK_DATA_MISSING = 'BankDataMissing',
  BANK_DATA_USER_MISMATCH = 'BankDataUserMismatch',
  BIC_BLACKLISTED = 'BicBlacklisted',
  IBAN_BLACKLISTED = 'IbanBlacklisted',
  CARD_BLACKLISTED = 'CardBlacklisted',
  INPUT_AML_CHECK_FAILED = 'InputAmlFailed',
  INPUT_NOT_CONFIRMED = 'InputNotConfirmed',
  IP_MISMATCH = 'IpMismatch',
  SUSPICIOUS_MAIL = 'SuspiciousMail',
}

export const AmlPendingError = [AmlError.IP_MISMATCH, AmlError.SUSPICIOUS_MAIL];
