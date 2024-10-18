import { PaymentQuote } from '../entities/payment-quote.entity';
import { PaymentQuoteStatus } from '../enums';

const defaultPaymentQuote: Partial<PaymentQuote> = {
  id: 1,
  status: PaymentQuoteStatus.ACTUAL,
  uniqueId: 'plq_a1b2c3',
  transferAmounts:
    '[{"method":"Lightning","minFee":0,"assets":[{"asset":"BTC","amount":0.00039232}]},{"method":"Ethereum","minFee":16304038039,"assets":[{"asset":"ETH","amount":0.00897592},{"asset":"ZCHF","amount":20}]},{"method":"Arbitrum","minFee":110000000,"assets":[{"asset":"ETH","amount":0.00897592},{"asset":"ZCHF","amount":20}]},{"method":"Optimism","minFee":1100400,"assets":[{"asset":"ETH","amount":0.00897592},{"asset":"ZCHF","amount":20}]}]',
};

export function createDefaultPaymentQuote(): PaymentQuote {
  return createCustomPaymentQuote({});
}

export function createCustomPaymentQuote(customValues: Partial<PaymentQuote>): PaymentQuote {
  return Object.assign(new PaymentQuote(), { ...defaultPaymentQuote, payments: [], ...customValues });
}
