import { CheckoutService } from '../checkout.service';

describe('CheckoutService refund idempotency', () => {
  it('returns the payment actions used for refund reconciliation', async () => {
    const service = new CheckoutService();
    const actions = [{ id: 'action-1', type: 'Refund', approved: true }];
    const getActions = jest.fn().mockResolvedValue(actions);
    (service as any).checkout = { payments: { getActions } };

    await expect(service.getPaymentActions('payment-1')).resolves.toBe(actions);
    expect(getActions).toHaveBeenCalledWith('payment-1');
  });

  it('uses a stable initial BuyCrypto idempotency key', async () => {
    const service = new CheckoutService();
    const refund = jest.fn().mockResolvedValue({ action_id: 'action-1' });
    (service as any).checkout = { payments: { refund } };

    await service.refundBuyCryptoPayment('payment-1', 130504);

    expect(refund).toHaveBeenCalledWith(
      'payment-1',
      { reference: 'bc-130504-refund' },
      'buy-crypto-130504-checkout-refund',
    );
  });

  it('uses a fresh stable key after a failed refund action', async () => {
    const service = new CheckoutService();
    const refund = jest.fn().mockResolvedValue({ action_id: 'action-2' });
    (service as any).checkout = { payments: { refund } };

    await service.refundBuyCryptoPayment('payment-1', 130504, 'action-failed');

    expect(refund).toHaveBeenCalledWith(
      'payment-1',
      { reference: 'bc-130504-refund' },
      'buy-crypto-refund-130504-action-failed',
    );
  });

  it('keeps the workflow reference within the 30-character card-network limit', () => {
    expect(CheckoutService.buyCryptoRefundReference(Number.MAX_SAFE_INTEGER)).toHaveLength(26);
  });
});
