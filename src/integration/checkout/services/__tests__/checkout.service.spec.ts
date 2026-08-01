import { CheckoutService } from '../checkout.service';

describe('CheckoutService', () => {
  it('forwards the refund idempotency key to the Checkout SDK', async () => {
    const service = new CheckoutService();
    const refund = jest.fn().mockResolvedValue({ reference: 'refund-22' });
    (service as any).checkout = { payments: { refund } };

    await service.refundPayment('pay-22', 'buy-crypto-7-checkout-refund');

    expect(refund).toHaveBeenCalledWith('pay-22', undefined, 'buy-crypto-7-checkout-refund');
  });
});
