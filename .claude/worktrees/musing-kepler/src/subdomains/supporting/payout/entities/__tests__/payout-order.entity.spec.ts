import { PayoutOrderStatus } from '../payout-order.entity';
import { createCustomPayoutOrder } from '../__mocks__/payout-order.entity.mock';

describe('PayoutOrder', () => {
  describe('#pendingPreparation(...)', () => {
    it('sets transferTxId', () => {
      const entity = createCustomPayoutOrder({
        transferTxId: undefined,
      });

      expect(entity.transferTxId).toBeUndefined();

      entity.pendingPreparation('TTX_01');

      expect(entity.transferTxId).toBe('TTX_01');
    });

    it('sets status to PayoutOrderStatus.PREPARATION_PENDING', () => {
      const entity = createCustomPayoutOrder({
        status: undefined,
      });

      expect(entity.status).toBeUndefined();

      entity.pendingPreparation('TTX_01');

      expect(entity.status).toBe(PayoutOrderStatus.PREPARATION_PENDING);
    });
  });

  describe('#preparationConfirmed(...)', () => {
    it('sets status to PayoutOrderStatus.PREPARATION_CONFIRMED', () => {
      const entity = createCustomPayoutOrder({
        status: undefined,
      });

      expect(entity.status).toBeUndefined();

      entity.preparationConfirmed();

      expect(entity.status).toBe(PayoutOrderStatus.PREPARATION_CONFIRMED);
    });
  });

  describe('#designatePayout(...)', () => {
    it('sets status to PayoutOrderStatus.PAYOUT_DESIGNATED in order to handle possible blockchain timeout errors', () => {
      const entity = createCustomPayoutOrder({
        status: undefined,
      });

      expect(entity.status).toBeUndefined();

      entity.designatePayout();

      expect(entity.status).toBe(PayoutOrderStatus.PAYOUT_DESIGNATED);
    });
  });

  describe('#rollbackPayoutDesignation(...)', () => {
    it('rolls back status to PayoutOrderStatus.PREPARATION_CONFIRMED for retry in case of safe blockchain errors', () => {
      const entity = createCustomPayoutOrder({
        status: undefined,
      });

      expect(entity.status).toBeUndefined();

      entity.rollbackPayoutDesignation();

      expect(entity.status).toBe(PayoutOrderStatus.PREPARATION_CONFIRMED);
    });
  });

  describe('#pendingInvestigation(...)', () => {
    it('sets status to PayoutOrderStatus.PAYOUT_UNCERTAIN in order to filter out order from normal flow', () => {
      const entity = createCustomPayoutOrder({
        status: undefined,
      });

      expect(entity.status).toBeUndefined();

      entity.pendingInvestigation();

      expect(entity.status).toBe(PayoutOrderStatus.PAYOUT_UNCERTAIN);
    });
  });

  describe('#pendingPayout(...)', () => {
    it('sets transferTxId', () => {
      const entity = createCustomPayoutOrder({
        payoutTxId: undefined,
      });

      expect(entity.payoutTxId).toBeUndefined();

      entity.pendingPayout('PID_01');

      expect(entity.payoutTxId).toBe('PID_01');
    });

    it('sets status to PayoutOrderStatus.PAYOUT_PENDING', () => {
      const entity = createCustomPayoutOrder({
        status: undefined,
      });

      expect(entity.status).toBeUndefined();

      entity.pendingPayout('PID_01');

      expect(entity.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
    });
  });

  describe('#complete(...)', () => {
    it('sets status to PayoutOrderStatus.COMPLETE', () => {
      const entity = createCustomPayoutOrder({
        status: undefined,
      });

      expect(entity.status).toBeUndefined();

      entity.complete();

      expect(entity.status).toBe(PayoutOrderStatus.COMPLETE);
    });
  });
});
