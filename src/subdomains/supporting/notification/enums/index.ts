export enum NotificationType {
  MAIL = 'Mail',
}

export enum MailType {
  GENERIC = 'Generic',
  ERROR_MONITORING = 'ErrorMonitoring',
  USER = 'User',
  PERSONAL = 'Personal',
  INTERNAL = 'Internal',
}

export enum MailContext {
  BUY_CRYPTO = 'BuyCrypto',
  BUY_CRYPTO_PENDING = 'BuyCryptoPending',
  BUY_CRYPTO_RETURN = 'BuyCryptoReturn',
  BUY_FIAT = 'BuyFiat',
  BUY_FIAT_PENDING = 'BuyFiatPending',
  BUY_FIAT_RETURN = 'BuyFiatReturn',
  CRYPTO_INPUT_RETURN = 'CryptoInputReturn',
  CHECKOUT_TX = 'CheckoutTx',
  SEPA = 'SEPA',
  WEBHOOK = 'Webhook',
  BLACK_SQUAD = 'BlackSquad',
  CHANGED_MAIL = 'ChangedMail',
  ADDED_ADDRESS = 'AddedAddress',
  ACCOUNT_MERGE_REQUEST = 'AccountMergeRequest',
  LOGIN = 'Login',
  LIMIT_REQUEST = 'LimitRequest',
  KYC_CHANGED = 'KycChanged',
  KYC_FAILED = 'KycFailed',
  KYC_REMINDER = 'KycReminder',
  CUSTOM = 'Custom',
  REF_REWARD = 'RefReward',
  MONITORING = 'Monitoring',
  DEX = 'Dex',
  PAYOUT = 'Payout',
  PRICING = 'Pricing',
  LIQUIDITY_MANAGEMENT = 'LiquidityManagement',
}
