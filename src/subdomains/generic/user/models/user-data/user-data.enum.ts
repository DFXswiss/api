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

export enum PhoneCallPreferredTimes {
  BETWEEN_9_AND_10 = 'Between9And10',
  BETWEEN_10_AND_11 = 'Between10And11',
  BETWEEN_11_AND_12 = 'Between11And12',
  BETWEEN_12_AND_13 = 'Between12And13',
  BETWEEN_13_AND_14 = 'Between13And14',
  BETWEEN_14_AND_15 = 'Between14And15',
  BETWEEN_15_AND_16 = 'Between15And16',
  BETWEEN_9_AND_16 = 'Between9And16',
}

export enum PhoneCallStatus {
  REPEAT = 'Repeat',
  DENIED = 'Denied',
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
