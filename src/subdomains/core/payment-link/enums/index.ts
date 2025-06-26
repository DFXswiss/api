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
  TX_CHECKBOT = 'TxCheckbot',
  TX_MEMPOOL = 'TxMempool',
  TX_BLOCKCHAIN = 'TxBlockchain',
  TX_COMPLETED = 'TxCompleted',
  TX_FAILED = 'TxFailed',
}

export const PaymentQuoteTxStates = [
  PaymentQuoteStatus.TX_RECEIVED,
  PaymentQuoteStatus.TX_CHECKBOT,
  PaymentQuoteStatus.TX_MEMPOOL,
  PaymentQuoteStatus.TX_BLOCKCHAIN,
  PaymentQuoteStatus.TX_COMPLETED,
];

export const PaymentQuoteFinalStates = [
  PaymentQuoteStatus.CANCELLED,
  PaymentQuoteStatus.EXPIRED,
  PaymentQuoteStatus.TX_CHECKBOT,
  PaymentQuoteStatus.TX_MEMPOOL,
  PaymentQuoteStatus.TX_BLOCKCHAIN,
  PaymentQuoteStatus.TX_COMPLETED,
  PaymentQuoteStatus.TX_FAILED,
];

export enum PaymentActivationStatus {
  OPEN = 'Open',
  CLOSED = 'Closed',
}

export enum PaymentLinkMode {
  SINGLE = 'Single',
  MULTIPLE = 'Multiple',
  DONATION = 'Donation',
}

export enum PaymentLinkPaymentMode {
  SINGLE = 'Single',
  MULTIPLE = 'Multiple',
}

export enum PaymentStandard {
  OPEN_CRYPTO_PAY = 'OpenCryptoPay',
  LIGHTNING_BOLT11 = 'LightningBolt11',
  PAY_TO_ADDRESS = 'PayToAddress',
}

export enum CreatePaymentAccessLevel {
  USER = 'user',
  ACCESS_KEY = 'access-key',
  PUBLIC = 'public',
}