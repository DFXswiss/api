export enum AmlReason {
  NA = 'NA',
  MONTHLY_LIMIT = 'MonthlyLimit',
  ANNUAL_LIMIT = 'AnnualLimit',
  USER_DATA_MISMATCH = 'UserDataMismatch',
  IBAN_CHECK = 'IbanCheck',
  KYC_REJECTED = 'KycRejected',
  OLKY_NO_KYC = 'OlkyNoKyc',
  MIN_DEPOSIT_NOT_REACHED = 'MinDepositNotReached',
  NAME_CHECK_WITHOUT_KYC = 'NameCheckWithoutKyc',
  ANNUAL_LIMIT_WITHOUT_KYC = 'AnnualLimitWithoutKyc',
  ASSET_CURRENTLY_NOT_AVAILABLE = 'AssetCurrentlyNotAvailable',
  ASSET_NOT_AVAILABLE_WITH_CHOSEN_BANK = 'AssetNotAvailableWithChosenBank',
  STAKING_DISCONTINUED = 'StakingDiscontinued',
  BANK_NOT_ALLOWED = 'BankNotAllowed',
  COUNTRY_NOT_ALLOWED = 'CountryNotAllowed',
  HIGH_RISK_KYC_NEEDED = 'HighRiskKycNeeded',
  HIGH_RISK_BLOCKED = 'HighRiskBlocked',
  MANUAL_CHECK = 'ManualCheck',
  MANUAL_CHECK_BANK_DATA = 'ManualCheckBankData',
  NO_COMMUNICATION = 'NoCommunication',
  FEE_TOO_HIGH = 'FeeTooHigh',
  RECEIVER_REJECTED_TX = 'ReceiverRejectedTx',
  CHF_ABROAD_TX = 'ChfAbroadTx',
  ASSET_KYC_NEEDED = 'AssetKycNeeded',
  CARD_NAME_MISMATCH = 'CardNameMismatch',
  USER_BLOCKED = 'UserBlocked',
  USER_DATA_BLOCKED = 'UserDataBlocked',
  USER_DELETED = 'UserDeleted',
  VIDEO_IDENT_NEEDED = 'VideoIdentNeeded',
  MISSING_LIQUIDITY = 'MissingLiquidity',
  TEST_ONLY = 'TestOnly',
  KYC_DATA_NEEDED = 'KycDataNeeded',
  BANK_TX_NEEDED = 'BankTxNeeded',
  MERGE_INCOMPLETE = 'MergeIncomplete',
  MANUAL_CHECK_PHONE = 'ManualCheckPhone',
  MANUAL_CHECK_IP_PHONE = 'ManualCheckIpPhone',
  MANUAL_CHECK_IP_COUNTRY_PHONE = 'ManualCheckIpCountryPhone',
  BANK_RELEASE_PENDING = 'BankReleasePending',
}

export const KycAmlReasons = [
  AmlReason.MONTHLY_LIMIT,
  AmlReason.OLKY_NO_KYC,
  AmlReason.NAME_CHECK_WITHOUT_KYC,
  AmlReason.ANNUAL_LIMIT_WITHOUT_KYC,
  AmlReason.HIGH_RISK_KYC_NEEDED,
  AmlReason.ASSET_KYC_NEEDED,
  AmlReason.VIDEO_IDENT_NEEDED,
  AmlReason.KYC_DATA_NEEDED,
];

export const RecheckAmlReasons = [
  AmlReason.MANUAL_CHECK_PHONE,
  AmlReason.MANUAL_CHECK_IP_PHONE,
  AmlReason.MANUAL_CHECK_BANK_DATA,
  AmlReason.VIDEO_IDENT_NEEDED,
  AmlReason.MONTHLY_LIMIT,
  AmlReason.OLKY_NO_KYC,
  AmlReason.NAME_CHECK_WITHOUT_KYC,
  AmlReason.ANNUAL_LIMIT_WITHOUT_KYC,
  AmlReason.HIGH_RISK_KYC_NEEDED,
  AmlReason.ASSET_KYC_NEEDED,
  AmlReason.KYC_DATA_NEEDED,
  AmlReason.BANK_RELEASE_PENDING,
];

export const BlockAmlReasons = [AmlReason.MANUAL_CHECK, AmlReason.MANUAL_CHECK_IP_COUNTRY_PHONE];

export const AmlReasonWithoutReason = [
  AmlReason.NA,
  AmlReason.MANUAL_CHECK,
  AmlReason.MANUAL_CHECK_BANK_DATA,
  AmlReason.USER_BLOCKED,
  AmlReason.USER_DATA_BLOCKED,
  AmlReason.BANK_RELEASE_PENDING,
];

export const NotRefundableAmlReasons = [AmlReason.BANK_RELEASE_PENDING];
