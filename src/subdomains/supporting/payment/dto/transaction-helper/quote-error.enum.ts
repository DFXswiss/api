export enum QuoteError {
  AMOUNT_TOO_LOW = 'AmountTooLow',
  AMOUNT_TOO_HIGH = 'AmountTooHigh',
  BANK_TRANSACTION_MISSING = 'BankTransactionMissing',
  KYC_REQUIRED = 'KycRequired',
  KYC_DATA_REQUIRED = 'KycDataRequired',
  KYC_REQUIRED_INSTANT = 'KycRequiredInstant',
  LIMIT_EXCEEDED = 'LimitExceeded',
  NATIONALITY_NOT_ALLOWED = 'NationalityNotAllowed',
  NAME_REQUIRED = 'NameRequired',
  VIDEO_IDENT_REQUIRED = 'VideoIdentRequired',
  IBAN_CURRENCY_MISMATCH = 'IbanCurrencyMismatch',
}
