export enum FiatPaymentMethod {
  BANK = 'Bank',
  CARD = 'Card',
}

export enum CryptoPaymentMethod {
  CRYPTO = 'Crypto',
}

export type PaymentMethod = FiatPaymentMethod | CryptoPaymentMethod;
