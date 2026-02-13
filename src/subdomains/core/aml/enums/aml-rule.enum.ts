export enum AmlRule {
  SKIP_AML_CHECK = -1, // skip amlCheck only possible in dev or loc env
  DEFAULT = 0, // default
  RULE_1 = 1, // IP Check
  RULE_2 = 2, // KycLevel 30
  RULE_3 = 3, // KycLevel 50
  RULE_4 = 4, // UserData maxWeeklyVolume
  RULE_5 = 5, // No suspiciousMail check
  RULE_6 = 6, // Checkout KycLevel 30
  RULE_7 = 7, // Checkout KycLevel 50
  RULE_8 = 8, // CHF amount > 10k
  RULE_9 = 9, // Checkout Active User & KycLevel 30
  RULE_10 = 10, // Checkout Active User & KycLevel 50
  RULE_11 = 11, // Special IP countries without Kyc
  RULE_12 = 12, // Checkout BankTransactionVerificationDate & KycLevel 30
  RULE_13 = 13, // Checkout BankTransactionVerificationDate & KycLevel 50
  RULE_14 = 14, // No phoneCallCheck
  RULE_15 = 15, // Force Manual Check
  RULE_16 = 16, // Force phoneCallCheck for buyCrypto with personal accounts
}

export const SpecialIpCountries = ['CH'];
