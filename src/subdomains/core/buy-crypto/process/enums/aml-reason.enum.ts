export enum AmlReason {
  NA = 'NA',
  DAILY_LIMIT = 'DailyLimit',
  ANNUAL_LIMIT = 'AnnualLimit',
  USER_DATA_MISMATCH = 'UserDataMismatch',
  IBAN_CHECK = 'IbanCheck',
  KYC_REJECTED = 'KycRejected',
  OLKY_NO_KYC = 'OlkyNoKyc',
  MIN_DEPOSIT_NOT_REACHED = 'MinDepositNotReached',
  NAME_CHECK_WITHOUT_KYC = 'NameCheckWithoutKYC',
  ANNUAL_LIMIT_WITHOUT_KYC = 'AnnualLimitWithoutKYC',
  ASSET_CURRENTLY_NOT_AVAILABLE = 'AssetCurrentlyNotAvailable',
}
