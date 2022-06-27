import { BuyCryptoBatch, BuyCryptoBatchStatus } from '../buy-crypto-batch.entity';
import { createCustomBuyCryptoBatch, createDefaultBuyCryptoBatch } from './mock/buy-crypto-batch.entity.mock';
import { createCustomBuyCrypto, createDefaultBuyCrypto } from './mock/buy-crypto.entity.mock';

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

  describe('#secure(...)', () => {
    it('sets outputAmount', () => {
      const entity = createCustomBuyCryptoBatch({
        transactions: [createCustomBuyCrypto({ outputAmount: 100, outputReferenceAmount: 100 })],
        outputAmount: undefined,
        outputReferenceAmount: 100,
      });

      expect(entity.outputAmount).toBeUndefined();

      entity.secure(100);

      expect(entity.outputAmount).toBe(100);
    });

    it('sets status to SECURED', () => {
      const entity = createCustomBuyCryptoBatch({
        transactions: [createCustomBuyCrypto({ outputAmount: 100, outputReferenceAmount: 100 })],
        outputReferenceAmount: 100,
        status: undefined,
      });

      expect(entity.status).toBeUndefined();

      entity.secure(100);

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

      entity.secure(90);

      expect(transactionA.outputAmount).toBe(30);
      expect(transactionB.outputAmount).toBe(60);
    });

    it('fixes outputAmount rounding issues after distribution between transactions, by adjusting first transaction', () => {
      const transactionA = createCustomBuyCrypto({ outputAmount: undefined, outputReferenceAmount: 1 });
      const transactionB = createCustomBuyCrypto({ outputAmount: undefined, outputReferenceAmount: 1 });
      const transactionC = createCustomBuyCrypto({ outputAmount: undefined, outputReferenceAmount: 1 });
      const entity = createCustomBuyCryptoBatch({
        transactions: [transactionA, transactionB, transactionC],
        outputReferenceAmount: 3,
      });

      entity.secure(1);

      expect(transactionA.outputAmount).toBe(0.33333334);
      expect(transactionB.outputAmount).toBe(0.33333333);
      expect(transactionC.outputAmount).toBe(0.33333333);
    });

    it('throws error if sum of tx outputAmount and batch total outputAmount differs more than 0.00001', () => {
      const transactionA = createCustomBuyCrypto({ outputAmount: undefined, outputReferenceAmount: 10 });
      const transactionB = createCustomBuyCrypto({ outputAmount: undefined, outputReferenceAmount: 10 });
      const entity = createCustomBuyCryptoBatch({
        transactions: [transactionA, transactionB],
        outputReferenceAmount: 30,
        outputAsset: 'BTC',
      });

      const testCall = () => entity.secure(30);

      expect(testCall).toThrow();
      expect(testCall).toThrowError('Output amount mismatch is too high. Mismatch: 10 BTC');
    });

    it('returns instance of BuyCryptoBatch', () => {
      const entity = createCustomBuyCryptoBatch({ transactions: [] });

      const updatedEntity = entity.secure(0);

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

  describe('#pending(...)', () => {
    it('sets a purchaseTxId', () => {
      const entity = createCustomBuyCryptoBatch({ purchaseTxId: undefined });

      expect(entity.purchaseTxId).toBeUndefined();

      entity.pending('P_ID_01');

      expect(entity.purchaseTxId).toBe('P_ID_01');
    });

    it('sets a status to PENDING_LIQUIDITY', () => {
      const entity = createCustomBuyCryptoBatch({ status: undefined });

      expect(entity.status).toBeUndefined();

      entity.pending('P_ID_01');

      expect(entity.status).toBe(BuyCryptoBatchStatus.PENDING_LIQUIDITY);
    });

    it('returns instance of BuyCryptoBatch', () => {
      const entity = createDefaultBuyCryptoBatch();

      const updatedEntity = entity.pending('P_ID_01');

      expect(updatedEntity).toBeInstanceOf(BuyCryptoBatch);
    });
  });

  describe('#recordDexToOutTransfer(...)', () => {
    it('sets outTxId after sending outputAmount to OUT node', () => {
      const entity = createCustomBuyCryptoBatch({ outTxId: undefined });

      expect(entity.outTxId).toBeUndefined();

      entity.recordDexToOutTransfer('OUT_ID_01');

      expect(entity.outTxId).toBe('OUT_ID_01');
    });

    it('returns instance of BuyCryptoBatch', () => {
      const entity = createDefaultBuyCryptoBatch();

      const updatedEntity = entity.recordDexToOutTransfer('OUT_ID_01');

      expect(updatedEntity).toBeInstanceOf(BuyCryptoBatch);
    });
  });
});
