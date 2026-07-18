import { getMetadataArgsStorage } from 'typeorm';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutOrder, PayoutOrderContext, PayoutOrderStatus } from '../payout-order.entity';
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

    it('returns this on a valid payoutTxId', () => {
      const entity = createCustomPayoutOrder({ payoutTxId: undefined, status: undefined });

      const result = entity.pendingPayout('PID_01');

      expect(result).toBe(entity);
    });

    it('throws and leaves the order untouched when no payoutTxId is provided', () => {
      const entity = createCustomPayoutOrder({
        payoutTxId: undefined,
        status: PayoutOrderStatus.PREPARATION_CONFIRMED,
      });

      expect(() => entity.pendingPayout('')).toThrowError('No payoutTxId provided to PayoutOrder #pendingPayout(...)');
      expect(entity.payoutTxId).toBeUndefined();
      expect(entity.status).toBe(PayoutOrderStatus.PREPARATION_CONFIRMED);
    });
  });

  describe('#rollbackPayout(...)', () => {
    it('clears payoutTxId and resets status to PayoutOrderStatus.PREPARATION_CONFIRMED for retry', () => {
      const entity = createCustomPayoutOrder({
        payoutTxId: 'PID_01',
        status: PayoutOrderStatus.PAYOUT_PENDING,
      });

      expect(entity.payoutTxId).toBe('PID_01');
      expect(entity.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);

      entity.rollbackPayout();

      expect(entity.payoutTxId).toBeNull();
      expect(entity.status).toBe(PayoutOrderStatus.PREPARATION_CONFIRMED);
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

  describe('#recordPreparationFee(...)', () => {
    it('stores the preparation fee asset, amount and CHF amount and returns this', () => {
      const entity = createCustomPayoutOrder({});
      const feeAsset = createCustomAsset({ name: 'BTC' });

      const result = entity.recordPreparationFee(feeAsset, 0.0001, 4.2);

      expect(result).toBe(entity);
      expect(entity.preparationFeeAsset).toBe(feeAsset);
      expect(entity.preparationFeeAmount).toBe(0.0001);
      expect(entity.preparationFeeAmountChf).toBe(4.2);
    });
  });

  describe('#recordPayoutFee(...)', () => {
    it('stores the payout fee asset, amount and CHF amount and returns this', () => {
      const entity = createCustomPayoutOrder({});
      const feeAsset = createCustomAsset({ name: 'BTC' });

      const result = entity.recordPayoutFee(feeAsset, 0.0002, 8.4);

      expect(result).toBe(entity);
      expect(entity.payoutFeeAsset).toBe(feeAsset);
      expect(entity.payoutFeeAmount).toBe(0.0002);
      expect(entity.payoutFeeAmountChf).toBe(8.4);
    });
  });

  describe('#recordPayoutFailure(...)', () => {
    it('increments retryCount, truncates the error to 2048 chars, sets lastAttemptDate and returns this', () => {
      const entity = createCustomPayoutOrder({ retryCount: 2 });
      const longMessage = 'X'.repeat(5000);

      const result = entity.recordPayoutFailure(longMessage);

      expect(result).toBe(entity);
      expect(entity.retryCount).toBe(3);
      expect(entity.lastError).toBe('X'.repeat(2048));
      expect(entity.lastError?.length).toBe(2048);
      expect(entity.lastAttemptDate).toBeInstanceOf(Date);
    });

    it('starts retryCount at 1 when it was previously undefined', () => {
      const entity = createCustomPayoutOrder({ retryCount: undefined });

      entity.recordPayoutFailure('boom');

      expect(entity.retryCount).toBe(1);
      expect(entity.lastError).toBe('boom');
    });

    it('leaves lastError undefined when no message is provided', () => {
      const entity = createCustomPayoutOrder({ retryCount: 0 });

      entity.recordPayoutFailure(undefined as unknown as string);

      expect(entity.retryCount).toBe(1);
      expect(entity.lastError).toBeUndefined();
      expect(entity.lastAttemptDate).toBeInstanceOf(Date);
    });
  });

  describe('#resetPayoutRetry(...)', () => {
    it('clears retryCount, lastError and lastAttemptDate and returns this', () => {
      const entity = createCustomPayoutOrder({ retryCount: 5 });
      entity.lastError = 'previous error';
      entity.lastAttemptDate = new Date();

      const result = entity.resetPayoutRetry();

      expect(result).toBe(entity);
      expect(entity.retryCount).toBe(0);
      expect(entity.lastError).toBeNull();
      expect(entity.lastAttemptDate).toBeNull();
    });
  });

  describe('#payoutFee', () => {
    it('returns the payout fee asset and the rounded sum of payout and preparation amounts', () => {
      const feeAsset = createCustomAsset({ name: 'BTC' });
      const entity = createCustomPayoutOrder({});
      entity.payoutFeeAsset = feeAsset;
      entity.payoutFeeAmount = 0.00000002;
      entity.preparationFeeAmount = 0.00000001;

      expect(entity.payoutFee).toEqual({ asset: feeAsset, amount: 0.00000003 });
    });
  });

  describe('#feeAmountChf', () => {
    it('sums the preparation and payout CHF fee amounts', () => {
      const entity = createCustomPayoutOrder({});
      entity.preparationFeeAmountChf = 1.5;
      entity.payoutFeeAmountChf = 2.25;

      expect(entity.feeAmountChf).toBe(3.75);
    });
  });

  describe('ORM metadata', () => {
    it('maps asset, preparationFeeAsset and payoutFeeAsset as ManyToOne relations to Asset', () => {
      const relations = getMetadataArgsStorage().relations.filter((r) => r.target === PayoutOrder);
      const assetRelation = relations.find((r) => r.propertyName === 'asset');
      const preparationFeeRelation = relations.find((r) => r.propertyName === 'preparationFeeAsset');
      const payoutFeeRelation = relations.find((r) => r.propertyName === 'payoutFeeAsset');

      expect((assetRelation!.type as () => unknown)()).toBe(Asset);
      expect((preparationFeeRelation!.type as () => unknown)()).toBe(Asset);
      expect((payoutFeeRelation!.type as () => unknown)()).toBe(Asset);
    });

    it('declares a unique composite index on (context, correlationId)', () => {
      const index = getMetadataArgsStorage().indices.find(
        (i) => i.target === PayoutOrder && typeof i.columns === 'function',
      );

      expect(index).toBeDefined();
      expect(index!.unique).toBe(true);

      const order = createCustomPayoutOrder({ context: PayoutOrderContext.BUY_CRYPTO, correlationId: 'CID_XYZ' });
      const columns = (index!.columns as (p: PayoutOrder) => unknown[])(order);

      expect(columns).toEqual([PayoutOrderContext.BUY_CRYPTO, 'CID_XYZ']);
    });
  });
});
