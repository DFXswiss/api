export enum QuoteError {
  AMOUNT_TOO_LOW = 'AmountTooLow',
  AMOUNT_TOO_HIGH = 'AmountTooHigh',
  BANK_TRANSACTION_MISSING = 'BankTransactionMissing',
  KYC_REQUIRED_INSTANT = 'KycRequiredInstant',
  KYC_REQUIRED = 'KycRequired',
  BANK_TRANSACTION_MISSING_OR_KYC_REQUIRED = 'BankTransactionMissingOrKycRequired',
  DEPOSIT_LIMIT_REACHED = 'DepositLimitReached',
}
