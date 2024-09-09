export enum PaymentLinkStatus {
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
}

export enum PaymentLinkPaymentStatus {
  PENDING = 'Pending',
  COMPLETED = 'Completed',
  CANCELLED = 'Cancelled',
  EXPIRED = 'Expired',
}

export enum PaymentQuoteStatus {
  ACTUAL = 'Actual',
  CANCELLED = 'Cancelled',
  EXPIRED = 'Expired',

  TX_RECEIVED = 'TxReceived',
  TX_MEMPOOL = 'TxMempool',
  TX_BLOCKCHAIN = 'TxBlockchain',
  TX_COMPLETED = 'TxCompleted',
  TX_FAILED = 'TxFailed',
}

export enum PaymentActivationStatus {
  PENDING = 'Pending',
  EXPIRED = 'Expired',
  CANCELLED = 'Cancelled',
  COMPLETED = 'Completed',
}

export enum PaymentLinkEvmHexPaymentStatus {
  SUCCESS = 'Success',
  FAILED = 'Failed',
}

export enum PaymentLinkPaymentMode {
  SINGLE = 'Single',
  MULTIPLE = 'Multiple',
}

export enum PaymentStandard {
  OPEN_CRYPTO_PAY = 'OpenCryptoPay',
  FRANKENCOIN_PAY = 'FrankencoinPay',
  LIGHTNING_BOLT11 = 'LightningBolt11',
  PAY_TO_ADDRESS = 'PayToAddress',
}
