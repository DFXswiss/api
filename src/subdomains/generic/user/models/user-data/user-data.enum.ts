export enum KycStatus {
  NA = 'NA',
  CHECK = 'Check',
  COMPLETED = 'Completed',
  REJECTED = 'Rejected',
  TERMINATED = 'Terminated',
}

export enum RiskStatus {
  NA = 'NA',
  SUSPICIOUS = 'Suspicious',
  BLOCKED = 'Blocked',
  BLOCKED_BUY_CRYPTO = 'BlockedBuyCrypto',
  BLOCKED_BUY_FIAT = 'BlockedBuyFiat',
  RELEASED = 'Released',
}

export enum PhoneCallPreferredTime {
  H_9_TO_10 = 'H9To10',
  H_10_TO_11 = 'H10To11',
  H_11_TO_12 = 'H11To12',
  H_12_TO_13 = 'H12To13',
  H_13_TO_14 = 'H13To14',
  H_14_TO_15 = 'H14To15',
  H_15_TO_16 = 'H15To16',
  H_9_TO_16 = 'H9To16',
}

export enum PhoneCallStatus {
  REPEAT = 'Repeat',
  REJECTED = 'Rejected',
  UNAVAILABLE = 'Unavailable',
  FAILED = 'Failed',
  COMPLETED = 'Completed',
  SUSPICIOUS = 'Suspicious',
}

export enum KycLevel {
  // automatic levels
  LEVEL_0 = 0, // nothing
  LEVEL_10 = 10, // contact data
  LEVEL_20 = 20, // personal data

  // verified levels
  LEVEL_30 = 30, // ident
  LEVEL_40 = 40, // financial data
  LEVEL_50 = 50, // dfx approval

  TERMINATED = -10,
  REJECTED = -20,
}

export enum KycState {
  NA = 'NA',
  FAILED = 'Failed',
  REMINDED = 'Reminded',
  REVIEW = 'Review',
}

export enum KycType {
  DFX = 'DFX',
  LOCK = 'LOCK',
}

export enum LegalEntity {
  AG = 'AG',
  GMBH = 'GmbH',
  UG = 'UG',
  GBR = 'GbR',
  ASSOCIATION = 'Association',
  FOUNDATION = 'Foundation',
  LIFE_INSURANCE = 'LifeInsurance',
  TRUST = 'Trust',
  OTHER = 'Other',
}

export enum SignatoryPower {
  SINGLE = 'Single',
  DOUBLE = 'Double',
  NONE = 'None',
}

export enum BlankType {
  PHONE,
  MAIL,
  WALLET_ADDRESS,
}

export enum LimitPeriod {
  MONTH = 'Month',
  YEAR = 'Year',
}

export enum UserDataStatus {
  NA = 'NA',
  ACTIVE = 'Active',
  BLOCKED = 'Blocked',
  MERGED = 'Merged',
  KYC_ONLY = 'KycOnly',
  DEACTIVATED = 'Deactivated',
}

export enum Moderator {
  WENDEL = 'Wendel',
}
