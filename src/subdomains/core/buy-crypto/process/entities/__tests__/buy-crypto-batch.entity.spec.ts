import { createCustomBuy } from 'src/subdomains/core/buy-crypto/routes/buy/__mocks__/buy.entity.mock';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { Util } from 'src/shared/utils/util';
import { createCustomUser } from 'src/subdomains/generic/user/models/user/__mocks__/user.entity.mock';
import { AbortBatchCreationException } from '../../exceptions/abort-batch-creation.exception';
import { BuyCryptoBatch, BuyCryptoBatchStatus } from '../buy-crypto-batch.entity';
import { BuyCryptoFee } from '../buy-crypto-fees.entity';
import { createCustomBuyCryptoBatch, createDefaultBuyCryptoBatch } from '../__mocks__/buy-crypto-batch.entity.mock';
import { createCustomBuyCrypto, createDefaultBuyCrypto } from '../__mocks__/buy-crypto.entity.mock';

jest.mock('src/config/config', () => ({
  Config: {
    buy: { fee: { limits: { configuredFeeLimit: 0.001, constantFeeLimit: 0.001 } } },
  },
}));

describe('BuyCryptoBatch', () => {
  describe('#addTransaction(...)', () => {
    it('sets transactions to empty array in case it is undefined', () => {
      const entity = createCustomBuyCryptoBatch({ transactions: undefined });

      expect(entity.transactions).toBeUndefined();

      entity.addTransaction(createDefaultBuyCrypto());

      expect(entity.transactions).toBeTruthy();
      expect(Array.isArray(entity.transactions)).toBe(true);
      expect(entity.transactions.length).toBe(1);
    });

    it('sets batch to the transaction to set relation in the DB', () => {
      const entity = createCustomBuyCryptoBatch({ transactions: [] });
      const transaction = createCustomBuyCrypto({ batch: undefined });

      expect(transaction.batch).toBeUndefined();

      entity.addTransaction(transaction);

      expect(transaction.batch).toBeTruthy();
      expect(transaction.batch).toBe(entity);
    });

    it('adds transaction to the list', () => {
      const entity = createDefaultBuyCryptoBatch();

      expect(Array.isArray(entity.transactions)).toBe(true);
      expect(entity.transactions.length).toBe(1);

      entity.addTransaction(createDefaultBuyCrypto());

      expect(Array.isArray(entity.transactions)).toBe(true);
      expect(entity.transactions.length).toBe(2);
    });

    it('defaults outputReferenceAmount to 0 if its undefined', () => {
      const entity = createCustomBuyCryptoBatch({ transactions: [], outputReferenceAmount: undefined });

      expect(entity.outputReferenceAmount).toBeUndefined();

      entity.addTransaction(createDefaultBuyCrypto());

      expect(entity.outputReferenceAmount).toBe(0.005);
    });

    it('adds transaction outputReferenceAmount to the batch total', () => {
      const entity = createCustomBuyCryptoBatch({ transactions: [], outputReferenceAmount: undefined });
      const transactionA = createCustomBuyCrypto({ outputReferenceAmount: 5 });
      const transactionB = createCustomBuyCrypto({ outputReferenceAmount: 10 });

      expect(entity.outputReferenceAmount).toBeUndefined();

      entity.addTransaction(transactionA);
      entity.addTransaction(transactionB);

      expect(entity.outputReferenceAmount).toBe(15);
    });

    it('returns instance of BuyCryptoBatch', () => {
      const entity = createDefaultBuyCryptoBatch();

      const updatedEntity = entity.addTransaction(createDefaultBuyCrypto());

      expect(updatedEntity).toBeInstanceOf(BuyCryptoBatch);
    });
  });

  describe('#optimizeByLiquidity(...)', () => {
    it('does not change the batch if available liquidity is enough', () => {
      const batch = createDiverseBuyCryptoBatch();

      batch.optimizeByLiquidity(112, 0);

      expect(batch.transactions.length).toBe(3);
      expect(batch.transactions[0].outputReferenceAmount).toBe(100);
      expect(batch.transactions[1].outputReferenceAmount).toBe(10);
      expect(batch.transactions[2].outputReferenceAmount).toBe(1);
      expect(batch.outputReferenceAmount).toBe(111);
    });

    it('returns no purchase requirement and no warning if available liquidity is enough', () => {
      const batch = createDiverseBuyCryptoBatch();

      const [isPurchaseRequired, liquidityWarning] = batch.optimizeByLiquidity(112, 0);

      expect(isPurchaseRequired).toBe(false);
      expect(liquidityWarning).toBe(false);
    });

    it('re-slices the batch if available liquidity is enough at least for one tx, but not for entire batch', () => {
      const batchA = createDiverseBuyCryptoBatch();

      batchA.optimizeByLiquidity(11, 0);

      expect(batchA.transactions.length).toBe(2);
      expect(batchA.transactions[0].outputReferenceAmount).toBe(1);
      expect(batchA.transactions[1].outputReferenceAmount).toBe(10);
      expect(batchA.outputReferenceAmount).toBe(11);

      const batchB = createDiverseBuyCryptoBatch();

      batchB.optimizeByLiquidity(5, 0);

      expect(batchB.transactions.length).toBe(1);
      expect(batchB.transactions[0].outputReferenceAmount).toBe(1);
      expect(batchB.outputReferenceAmount).toBe(1);
    });

    it('returns no purchase requirement and no warning if available liquidity is enough at least for one tx, but not for entire batch', () => {
      const batch = createDiverseBuyCryptoBatch();

      const [isPurchaseRequired, liquidityWarning] = batch.optimizeByLiquidity(5, 0);

      expect(isPurchaseRequired).toBe(false);
      expect(liquidityWarning).toBe(false);
    });

    it('re-slices the batch if purchasable liquidity is enough at least for one tx, but not for entire batch', () => {
      const batchA = createDiverseBuyCryptoBatch();

      batchA.optimizeByLiquidity(0.5, 11 * 1.06);

      expect(batchA.transactions.length).toBe(2);
      expect(batchA.transactions[0].outputReferenceAmount).toBe(1);
      expect(batchA.transactions[1].outputReferenceAmount).toBe(10);
      expect(batchA.outputReferenceAmount).toBe(11);

      const batchB = createDiverseBuyCryptoBatch();

      batchB.optimizeByLiquidity(0.5, 5);

      expect(batchB.transactions.length).toBe(1);
      expect(batchB.transactions[0].outputReferenceAmount).toBe(1);
      expect(batchB.outputReferenceAmount).toBe(1);
    });

    it('returns purchase requirement and a warning if purchasable liquidity is enough at least for one tx, but not for entire batch', () => {
      const batch = createDiverseBuyCryptoBatch();

      const [isPurchaseRequired, liquidityWarning] = batch.optimizeByLiquidity(0.5, 11 * 1.05);

      expect(isPurchaseRequired).toBe(true);
      expect(liquidityWarning).toBe(true);
    });

    it('aborts the batch if purchasable liquidity is not enough even for one tx', () => {
      const batch = createDiverseBuyCryptoBatch();

      const testCall = () => batch.optimizeByLiquidity(0.5, 0.5);

      expect(testCall).toThrow();
      expect(testCall).toThrowError(AbortBatchCreationException);
    });

    it('does not change batch if no upper conditions met', () => {
      const batch = createDiverseBuyCryptoBatch();

      batch.optimizeByLiquidity(0.5, 10000);

      expect(batch.transactions.length).toBe(3);
      expect(batch.transactions[0].outputReferenceAmount).toBe(100);
      expect(batch.transactions[1].outputReferenceAmount).toBe(10);
      expect(batch.transactions[2].outputReferenceAmount).toBe(1);
      expect(batch.outputReferenceAmount).toBe(111);
    });

    it('returns purchase requirement for entire batch and no warning if no upper conditions met', () => {
      const batch = createDiverseBuyCryptoBatch();

      const [isPurchaseRequired, liquidityWarning] = batch.optimizeByLiquidity(0.5, 10000);

      expect(isPurchaseRequired).toBe(true);
      expect(liquidityWarning).toBe(false);
    });
  });

  describe('#checkAndRecordFeesEstimations(...)', () => {
    it('aborts batch creation if fee is too high', () => {
      const batch = createDiverseBuyCryptoBatch();

      const testCall = () => batch.checkAndRecordFeesEstimations(5, 3);

      expect(testCall).toThrow();
      expect(testCall).toThrowError('BuyCryptoBatch fee limit exceeded');
    });

    it('adds BuyCryptoFee instances to transactions if fee is acceptable', () => {
      const batch = createDiverseBuyCryptoBatch();

      batch.checkAndRecordFeesEstimations(0.03, 0.03);

      expect(batch.transactions[0].fee).toBeInstanceOf(BuyCryptoFee);
      expect(batch.transactions[1].fee).toBeInstanceOf(BuyCryptoFee);
      expect(batch.transactions[2].fee).toBeInstanceOf(BuyCryptoFee);
    });

    it('assigns fee proportions by transaction volume', () => {
      const batch = createDiverseBuyCryptoBatch();

      batch.checkAndRecordFeesEstimations(0.03, 0.03);

      expect(batch.transactions[0].fee.estimatePurchaseFeeAmount).toBe(0.02702703);
      expect(batch.transactions[0].fee.estimatePayoutFeeAmount).toBe(0.02702703);
      expect(batch.transactions[1].fee.estimatePurchaseFeeAmount).toBe(0.0027027);
      expect(batch.transactions[1].fee.estimatePayoutFeeAmount).toBe(0.0027027);
      expect(batch.transactions[2].fee.estimatePurchaseFeeAmount).toBe(0.00027027);
      expect(batch.transactions[2].fee.estimatePayoutFeeAmount).toBe(0.00027027);
    });
  });

  describe('#secure(...)', () => {
    it('sets outputAmount', () => {
      const entity = createCustomBuyCryptoBatch({
        transactions: [createCustomBuyCrypto({ outputAmount: 100, outputReferenceAmount: 100 })],
        outputAmount: undefined,
        outputReferenceAmount: 100,
      });

      expect(entity.outputAmount).toBeUndefined();

      entity.secure(100, 0);

      expect(entity.outputAmount).toBe(100);
    });

    it('sets status to SECURED', () => {
      const entity = createCustomBuyCryptoBatch({
        transactions: [createCustomBuyCrypto({ outputAmount: 100, outputReferenceAmount: 100 })],
        outputReferenceAmount: 100,
        status: undefined,
      });

      expect(entity.status).toBeUndefined();

      entity.secure(100, 0);

      expect(entity.status).toBe(BuyCryptoBatchStatus.SECURED);
    });

    it('distributes outputAmount between transactions', () => {
      const transactionA = createCustomBuyCrypto({ outputAmount: undefined, outputReferenceAmount: 10 });
      const transactionB = createCustomBuyCrypto({ outputAmount: undefined, outputReferenceAmount: 20 });
      const entity = createCustomBuyCryptoBatch({
        transactions: [transactionA, transactionB],
        outputReferenceAmount: 30,
      });

      expect(transactionA.outputAmount).toBeUndefined();
      expect(transactionB.outputAmount).toBeUndefined();

      entity.secure(90, 0);

      expect(transactionA.outputAmount).toBe(30);
      expect(transactionB.outputAmount).toBe(60);
    });

    it('fixes outputAmount rounding issues after distribution between transactions, by adjusting one transaction', () => {
      const transactionA = createCustomBuyCrypto({ outputAmount: undefined, outputReferenceAmount: 1 });
      const transactionB = createCustomBuyCrypto({ outputAmount: undefined, outputReferenceAmount: 1 });
      const transactionC = createCustomBuyCrypto({ outputAmount: undefined, outputReferenceAmount: 1 });
      const entity = createCustomBuyCryptoBatch({
        transactions: [transactionA, transactionB, transactionC],
        outputReferenceAmount: 3,
      });

      entity.secure(1, 0);

      expect(transactionA.outputAmount).toBe(0.33333334);
      expect(transactionB.outputAmount).toBe(0.33333333);
      expect(transactionC.outputAmount).toBe(0.33333333);
    });

    it('fixes outputAmount rounding issues after distribution between transactions, for ultra small amounts', () => {
      const entity = createCustomBuyCryptoBatch({
        status: BuyCryptoBatchStatus.CREATED,
        outputAsset: createCustomAsset({ dexName: 'MSFT' }),
        outputReferenceAmount: 0.010348,
        transactions: [
          ...[...new Array(200)].map((_, i) =>
            createCustomBuyCrypto({
              txId: null,
              outputReferenceAmount: 0.00005174,
              buy: createCustomBuy({ user: createCustomUser({ address: `ADDR_${i}` }) }),
            }),
          ),
        ],
      });

      expect(entity.transactions.length).toBe(200);

      entity.secure(0.00001105, 0);

      expect(entity.transactions[0].outputAmount).toBe(0.00000005);
      expect(entity.transactions[1].outputAmount).toBe(0.00000005);
      expect(entity.transactions[94].outputAmount).toBe(0.00000005);
      expect(entity.transactions[95].outputAmount).toBe(0.00000006);
      expect(entity.transactions[entity.transactions.length - 1].outputAmount).toBe(0.00000006);
      expect(
        Util.round(
          entity.transactions.reduce((acc, prev) => acc + prev.outputAmount, 0),
          8,
        ),
      ).toBe(0.00001105);
    });

    it('throws error if sum of tx outputAmount and batch total outputAmount differs more than 0.00001', () => {
      const transactionA = createCustomBuyCrypto({ outputAmount: undefined, outputReferenceAmount: 10 });
      const transactionB = createCustomBuyCrypto({ outputAmount: undefined, outputReferenceAmount: 10 });
      const entity = createCustomBuyCryptoBatch({
        transactions: [transactionA, transactionB],
        outputReferenceAmount: 30,
        outputAsset: createCustomAsset({ dexName: 'BTC' }),
      });

      const testCall = () => entity.secure(30, 0);

      expect(testCall).toThrow();
      expect(testCall).toThrowError('Output amount mismatch is too high. Mismatch: 10 BTC');
    });

    it('returns instance of BuyCryptoBatch', () => {
      const entity = createCustomBuyCryptoBatch({ transactions: [] });

      const updatedEntity = entity.secure(0, 0);

      expect(updatedEntity).toBeInstanceOf(BuyCryptoBatch);
    });
  });

  describe('#complete(...)', () => {
    it('sets a status to COMPLETE', () => {
      const entity = createCustomBuyCryptoBatch({ status: undefined });

      expect(entity.status).toBeUndefined();

      entity.complete();

      expect(entity.status).toBe(BuyCryptoBatchStatus.COMPLETE);
    });

    it('returns instance of BuyCryptoBatch', () => {
      const entity = createDefaultBuyCryptoBatch();

      const updatedEntity = entity.complete();

      expect(updatedEntity).toBeInstanceOf(BuyCryptoBatch);
    });
  });

  describe('#payingOut(...)', () => {
    it('sets a status to PAYING_OUT', () => {
      const entity = createCustomBuyCryptoBatch({ status: undefined });

      expect(entity.status).toBeUndefined();

      entity.payingOut();

      expect(entity.status).toBe(BuyCryptoBatchStatus.PAYING_OUT);
    });

    it('returns instance of BuyCryptoBatch', () => {
      const entity = createDefaultBuyCryptoBatch();

      const updatedEntity = entity.payingOut();

      expect(updatedEntity).toBeInstanceOf(BuyCryptoBatch);
    });
  });

  describe('#pending(...)', () => {
    it('sets a status to PENDING_LIQUIDITY', () => {
      const entity = createCustomBuyCryptoBatch({ status: undefined });

      expect(entity.status).toBeUndefined();

      entity.pending();

      expect(entity.status).toBe(BuyCryptoBatchStatus.PENDING_LIQUIDITY);
    });

    it('returns instance of BuyCryptoBatch', () => {
      const entity = createDefaultBuyCryptoBatch();

      const updatedEntity = entity.pending();

      expect(updatedEntity).toBeInstanceOf(BuyCryptoBatch);
    });
  });
});

function createDiverseBuyCryptoBatch(): BuyCryptoBatch {
  return createCustomBuyCryptoBatch({
    id: undefined,
    created: undefined,
    outputReferenceAmount: 111,
    transactions: [
      createCustomBuyCrypto({ outputReferenceAmount: 100 }),
      createCustomBuyCrypto({ outputReferenceAmount: 10 }),
      createCustomBuyCrypto({ outputReferenceAmount: 1 }),
    ],
  });
}
