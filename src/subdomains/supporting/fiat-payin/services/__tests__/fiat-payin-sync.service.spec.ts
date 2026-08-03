import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { CheckoutPayment, CheckoutPaymentStatus } from 'src/integration/checkout/dto/checkout.dto';
import { CheckoutService } from 'src/integration/checkout/services/checkout.service';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { EntityManager } from 'typeorm';
import { CheckoutTx } from '../../entities/checkout-tx.entity';
import { CheckoutTxRepository } from '../../repositories/checkout-tx.repository';
import { CheckoutTxService } from '../checkout-tx.service';
import { FiatPayInSyncService } from '../fiat-payin-sync.service';

describe('FiatPayInSyncService refund claims', () => {
  let service: FiatPayInSyncService;
  let checkoutService: DeepMocked<CheckoutService>;
  let checkoutTxRepo: DeepMocked<CheckoutTxRepository>;
  let manager: {
    update: jest.Mock;
    transaction: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(() => {
    checkoutService = createMock<CheckoutService>();
    checkoutTxRepo = createMock<CheckoutTxRepository>();
    manager = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      transaction: jest.fn(async (run: (entityManager: EntityManager) => unknown) =>
        run(manager as unknown as EntityManager),
      ),
      findOne: jest.fn(),
      save: jest.fn(async (_type, value) => value),
    };
    Object.defineProperty(checkoutTxRepo, 'manager', { configurable: true, value: manager });
    service = new FiatPayInSyncService(
      checkoutService,
      checkoutTxRepo,
      createMock<CheckoutTxService>(),
      createMock<TransactionService>(),
      createMock<SiftService>(),
      createMock<BuyService>(),
    );
    checkoutTxRepo.create.mockImplementation((value) => Object.assign(new CheckoutTx(), value));
    checkoutTxRepo.save.mockImplementation(async (value) => value as CheckoutTx);
  });

  function payment(status: CheckoutPaymentStatus): CheckoutPayment {
    return {
      id: 'payment-1',
      requested_on: new Date().toISOString(),
      amount: 100,
      currency: 'EUR',
      status,
      approved: true,
      reference: 'reference',
      description: 'description',
    } as CheckoutPayment;
  }

  function existingCheckoutTx(status: CheckoutPaymentStatus): CheckoutTx {
    return Object.assign(new CheckoutTx(), {
      id: 1,
      paymentId: 'payment-1',
      amount: 1,
      status,
      transaction: { id: 2 },
    });
  }

  function pendingRefund(chargebackRemittanceInfo: string | null = null): {
    buyCrypto: BuyCrypto;
    checkoutTx: CheckoutTx;
  } {
    const buyCrypto = Object.assign(new BuyCrypto(), { id: 130504, chargebackRemittanceInfo });
    buyCrypto.chargebackAllowedDate = new Date('2026-08-01T00:00:00Z');
    const checkoutTx = Object.assign(new CheckoutTx(), {
      id: 1,
      paymentId: 'payment-1',
      amount: 1,
      status: CheckoutPaymentStatus.REFUND_PENDING,
      buyCrypto,
    });
    return { buyCrypto, checkoutTx };
  }

  it('locks and reloads before applying a provider response so a concurrent claim is preserved', async () => {
    checkoutTxRepo.findOne.mockResolvedValue({ id: 1 } as CheckoutTx);
    manager.findOne
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce(existingCheckoutTx(CheckoutPaymentStatus.REFUND_PENDING));

    const result = await service.createCheckoutTx(payment(CheckoutPaymentStatus.CAPTURED));

    expect(manager.findOne).toHaveBeenNthCalledWith(
      1,
      CheckoutTx,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' }, loadEagerRelations: false }),
    );
    expect(result.status).toBe(CheckoutPaymentStatus.REFUND_PENDING);
  });

  it('replaces a local refund claim once the provider reports a terminal refund state', async () => {
    checkoutTxRepo.findOne.mockResolvedValue({ id: 1 } as CheckoutTx);
    manager.findOne
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce(existingCheckoutTx(CheckoutPaymentStatus.REFUND_PENDING));

    const result = await service.createCheckoutTx(payment(CheckoutPaymentStatus.REFUNDED));

    expect(result.status).toBe(CheckoutPaymentStatus.REFUNDED);
  });

  it.each([
    {
      current: CheckoutPaymentStatus.REFUNDED,
      stale: CheckoutPaymentStatus.CAPTURED,
      expected: CheckoutPaymentStatus.REFUNDED,
    },
    {
      current: CheckoutPaymentStatus.PARTIALLY_REFUNDED,
      stale: CheckoutPaymentStatus.CAPTURED,
      expected: CheckoutPaymentStatus.PARTIALLY_REFUNDED,
    },
  ])('does not regress $current when a stale $stale response arrives', async ({ current, stale, expected }) => {
    checkoutTxRepo.findOne.mockResolvedValue({ id: 1 } as CheckoutTx);
    manager.findOne.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce(existingCheckoutTx(current));

    const result = await service.createCheckoutTx(payment(stale));

    expect(result.status).toBe(expected);
  });

  it('submits an initial refund only when the provider has no refund action and records the action id', async () => {
    const { buyCrypto, checkoutTx } = pendingRefund();
    checkoutService.getPaymentActions.mockResolvedValue([]);
    checkoutService.refundBuyCryptoPayment.mockResolvedValue({
      action_id: 'action-1',
      _links: { payment: { href: 'payment-1' } },
    });

    await service['retryPendingRefunds']([checkoutTx]);

    expect(checkoutService.refundBuyCryptoPayment).toHaveBeenCalledWith('payment-1', 130504, undefined);
    expect(manager.update).toHaveBeenCalledWith(BuyCrypto, 130504, { chargebackRemittanceInfo: 'action-1' });
    expect(buyCrypto.chargebackRemittanceInfo).toBe('action-1');
  });

  it('adopts an accepted provider refund action without submitting a duplicate', async () => {
    const { buyCrypto, checkoutTx } = pendingRefund();
    checkoutService.getPaymentActions.mockResolvedValue([
      {
        id: 'action-1',
        type: 'Refund',
        amount: 100,
        reference: 'bc-130504-refund',
        approved: true,
      },
    ]);

    await service['retryPendingRefunds']([checkoutTx]);

    expect(checkoutService.refundBuyCryptoPayment).not.toHaveBeenCalled();
    expect(manager.update).toHaveBeenCalledWith(BuyCrypto, 130504, { chargebackRemittanceInfo: 'action-1' });
    expect(buyCrypto.chargebackRemittanceInfo).toBe('action-1');
  });

  it('does not resubmit a refund when the stored action is still accepted', async () => {
    const { checkoutTx } = pendingRefund('action-1');
    checkoutService.getPaymentActions.mockResolvedValue([
      {
        id: 'action-1',
        type: 'refund',
        amount: 100,
        reference: 'bc-130504-refund',
        approved: true,
      },
    ]);

    await service['retryPendingRefunds']([checkoutTx]);

    expect(checkoutService.refundBuyCryptoPayment).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('submits a new idempotent attempt after the latest refund action failed', async () => {
    const { buyCrypto, checkoutTx } = pendingRefund('action-failed');
    checkoutService.getPaymentActions.mockResolvedValue([
      {
        id: 'action-failed',
        type: 'Refund',
        amount: 100,
        reference: 'bc-130504-refund',
        approved: false,
        processed_on: '2026-08-01T10:00:00Z',
      },
    ]);
    checkoutService.refundBuyCryptoPayment.mockResolvedValue({
      action_id: 'action-2',
      _links: { payment: { href: 'payment-1' } },
    });

    await service['retryPendingRefunds']([checkoutTx]);

    expect(checkoutService.refundBuyCryptoPayment).toHaveBeenCalledWith('payment-1', 130504, 'action-failed');
    expect(manager.update).toHaveBeenCalledWith(BuyCrypto, 130504, { chargebackRemittanceInfo: 'action-2' });
    expect(buyCrypto.chargebackRemittanceInfo).toBe('action-2');
  });

  it('does not adopt an unrelated or partial refund action', async () => {
    const { checkoutTx } = pendingRefund();
    checkoutService.getPaymentActions.mockResolvedValue([
      { id: 'manual', type: 'Refund', amount: 100, reference: 'manual-refund', approved: true },
      {
        id: 'partial',
        type: 'Refund',
        amount: 50,
        reference: 'bc-130504-refund',
        approved: true,
      },
      {
        id: 'old-unreferenced',
        type: 'Refund',
        amount: 100,
        approved: true,
        processed_on: '2026-07-31T23:00:00Z',
      },
    ]);
    checkoutService.refundBuyCryptoPayment.mockResolvedValue({
      action_id: 'action-full',
      _links: { payment: { href: 'payment-1' } },
    });

    await service['retryPendingRefunds']([checkoutTx]);

    expect(checkoutService.refundBuyCryptoPayment).toHaveBeenCalledWith('payment-1', 130504, undefined);
    expect(manager.update).toHaveBeenCalledWith(BuyCrypto, 130504, { chargebackRemittanceInfo: 'action-full' });
  });

  it('adopts a legacy unreferenced full refund created after the local claim', async () => {
    const { buyCrypto, checkoutTx } = pendingRefund();
    checkoutService.getPaymentActions.mockResolvedValue([
      {
        id: 'legacy-action',
        type: 'Refund',
        amount: 100,
        approved: true,
        processed_on: '2026-08-01T00:01:00Z',
      },
    ]);

    await service['retryPendingRefunds']([checkoutTx]);

    expect(checkoutService.refundBuyCryptoPayment).not.toHaveBeenCalled();
    expect(manager.update).toHaveBeenCalledWith(BuyCrypto, 130504, {
      chargebackRemittanceInfo: 'legacy-action',
    });
    expect(buyCrypto.chargebackRemittanceInfo).toBe('legacy-action');
  });

  it('keeps a recent failed refund in cooldown', async () => {
    const { checkoutTx } = pendingRefund('action-failed');
    checkoutService.getPaymentActions.mockResolvedValue([
      {
        id: 'action-failed',
        type: 'Refund',
        amount: 100,
        reference: 'bc-130504-refund',
        approved: false,
        processed_on: new Date().toISOString(),
      },
    ]);

    await service['retryPendingRefunds']([checkoutTx]);

    expect(checkoutService.refundBuyCryptoPayment).not.toHaveBeenCalled();
  });

  it('stops and escalates after three matching refund attempts', async () => {
    const { checkoutTx } = pendingRefund('action-3');
    checkoutService.getPaymentActions.mockResolvedValue(
      [1, 2, 3].map((attempt) => ({
        id: `action-${attempt}`,
        type: 'Refund',
        amount: 100,
        reference: 'bc-130504-refund',
        approved: false,
        processed_on: `2026-08-01T0${attempt}:00:00Z`,
      })),
    );
    const error = jest.spyOn(service['logger'], 'error').mockImplementation();

    await service['retryPendingRefunds']([checkoutTx]);

    expect(checkoutService.refundBuyCryptoPayment).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('manual intervention required'));
  });

  it('does not submit when provider action reconciliation fails', async () => {
    const { buyCrypto, checkoutTx } = pendingRefund();
    checkoutService.getPaymentActions.mockRejectedValue(new Error('network timeout'));
    jest.spyOn(service['logger'], 'error').mockImplementation();

    await service['retryPendingRefunds']([checkoutTx]);

    expect(checkoutService.refundBuyCryptoPayment).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
    expect(checkoutTx.status).toBe(CheckoutPaymentStatus.REFUND_PENDING);
    expect(buyCrypto.chargebackRemittanceInfo).toBeNull();
  });
});
