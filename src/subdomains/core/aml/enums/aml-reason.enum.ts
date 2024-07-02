export enum AmlReason {
  NA = 'NA',
  DAILY_LIMIT = 'DailyLimit',
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
  NO_COMMUNICATION = 'NoCommunication',
  FEE_TOO_HIGH = 'FeeTooHigh',
  RECEIVER_REJECTED_TX = 'ReceiverRejectedTx',
  CHARGEBACK_NOT_POSSIBLE_NO_IBAN = 'ChargebackNotPossibleNoIban',
  ASSET_KYC_NEEDED = 'AssetKycNeeded',
}

export const KycAmlReasons = [
  AmlReason.DAILY_LIMIT,
  AmlReason.OLKY_NO_KYC,
  AmlReason.NAME_CHECK_WITHOUT_KYC,
  AmlReason.ANNUAL_LIMIT_WITHOUT_KYC,
  AmlReason.HIGH_RISK_KYC_NEEDED,
  AmlReason.ASSET_KYC_NEEDED,
];

export const AmlReasonWithoutReason = [AmlReason.NA, AmlReason.MANUAL_CHECK, AmlReason.CHARGEBACK_NOT_POSSIBLE_NO_IBAN];
