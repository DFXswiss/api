export enum AmlRule {
  DEFAULT = 0, // default
  RULE_1 = 1, // IP Check
  RULE_2 = 2, // KycLevel 30
  RULE_3 = 3, // KycLevel 50
  RULE_4 = 4, // UserData maxWeeklyVolume
  RULE_5 = 5, // No suspiciousMail check
  RULE_6 = 6, // Checkout KycLevel 30
  RULE_7 = 7, // Checkout KycLevel 50
  RULE_8 = 8, // CHF amount > 10k
}