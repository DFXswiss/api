import { PaymentStandardDto, PaymentStandardType } from '../dto/payment-standard.dto';

export const PAYMENT_STANDARDS: PaymentStandardDto[] = [
  {
    id: PaymentStandardType.OPEN_CRYPTO_PAY,
    label: 'OpenCryptoPay.io',
    description: 'Pay with OpenCryptoPay, Bitcoin Lightning LNURL',
    paymentIdentifierLabel: 'URL',
  },
  {
    id: PaymentStandardType.LIGHTNING_BOLT11,
    label: 'Bitcoin Lightning',
    description: 'Pay with a Bolt 11 Invoice',
    paymentIdentifierLabel: 'LNR',
  },
  {
    id: PaymentStandardType.PAY_TO_ADDRESS,
    label: '{{blockchain}} address',
    description: 'Pay to a {{blockchain}} Blockchain address',
    paymentIdentifierLabel: 'URI',
  },
];
