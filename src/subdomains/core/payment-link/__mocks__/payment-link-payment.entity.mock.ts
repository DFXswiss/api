import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentLinkPaymentMode, PaymentLinkPaymentStatus } from '../enums';

const defaultFiat: Partial<Fiat> = { name: 'CHF' };

const defaultPaymentLinkPayment: Partial<PaymentLinkPayment> = {
  id: 1,
  uniqueId: 'plp_1x2y3z',
  externalId: '20240827-00000001',
  status: PaymentLinkPaymentStatus.PENDING,
  mode: PaymentLinkPaymentMode.SINGLE,
  currency: Object.assign(new Fiat(), defaultFiat),
  amount: 123.45,
};

export function createDefaultPaymentLinkPayment(): PaymentLinkPayment {
  return createCustomPaymentLinkPayment({});
}

export function createCustomPaymentLinkPayment(customValues: Partial<PaymentLinkPayment>): PaymentLinkPayment {
  return Object.assign(new PaymentLinkPayment(), { ...defaultPaymentLinkPayment, ...customValues });
}
