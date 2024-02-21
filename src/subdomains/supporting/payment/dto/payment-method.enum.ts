export enum FiatPaymentMethod {
  BANK = 'Bank',
  INSTANT = 'Instant',
  CARD = 'Card',
}

export enum CryptoPaymentMethod {
  CRYPTO = 'Crypto',
}

export type PaymentMethod = FiatPaymentMethod | CryptoPaymentMethod;

export const PaymentMethodSwagger = [...Object.values(FiatPaymentMethod), ...Object.values(CryptoPaymentMethod)];
