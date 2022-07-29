import { createCustomBuy } from 'src/payment/models/buy/__tests__/mock/buy.entity.mock';
import { Util } from 'src/shared/util';
import { createCustomUser } from 'src/user/models/user/__tests__/mock/user.entity.mock';
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

    it('fixes outputAmount rounding issues after distribution between transactions, by adjusting one transaction', () => {
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

    it('fixes outputAmount rounding issues after distribution between transactions, for ultra small amounts', () => {
      const entity = createCustomBuyCryptoBatch({
        status: BuyCryptoBatchStatus.CREATED,
        outputAsset: 'MSFT',
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

      entity.secure(0.00001105);

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

  describe('#groupPayoutTransactions(...)', () => {
    it('throws error if attempted to create payout groups for not secured or paying-out batch', () => {
      const entity = createCustomBuyCryptoBatch({ status: BuyCryptoBatchStatus.CREATED });

      const testCall = () => entity.groupPayoutTransactions();

      expect(testCall).toThrow();
      expect(testCall).toThrowError(
        'Cannot payout batch which is not secured or paying-out. Batch ID: 1. Batch status: Created',
      );
    });

    it('creates 2 groups for non DFI asset and 11 unique transactions', () => {
      const entity = createCustomBuyCryptoBatch({
        status: BuyCryptoBatchStatus.SECURED,
        outputAsset: 'BTC',
        transactions: [
          ...[...new Array(11)].map((_, i) =>
            createCustomBuyCrypto({
              txId: null,
              buy: createCustomBuy({ user: createCustomUser({ address: `ADDR_${i}` }) }),
            }),
          ),
        ],
      });

      expect(entity.transactions.length).toBe(11);

      const groups = entity.groupPayoutTransactions();

      expect(groups.length).toBe(2);
      expect(groups[0].length).toBe(10);
      expect(groups[1].length).toBe(1);
    });

    it('creates 2 groups for DFI asset and 101 unique transactions', () => {
      const entity = createCustomBuyCryptoBatch({
        status: BuyCryptoBatchStatus.SECURED,
        outputAsset: 'DFI',
        transactions: [
          ...[...new Array(101)].map((_, i) =>
            createCustomBuyCrypto({
              txId: null,
              buy: createCustomBuy({ user: createCustomUser({ address: `ADDR_${i}` }) }),
            }),
          ),
        ],
      });

      expect(entity.transactions.length).toBe(101);

      const groups = entity.groupPayoutTransactions();

      expect(groups.length).toBe(2);
      expect(groups[0].length).toBe(100);
      expect(groups[1].length).toBe(1);
    });

    it('creates 2 groups 12 transactions, two of which contain duplicated address', () => {
      const entity = createCustomBuyCryptoBatch({
        status: BuyCryptoBatchStatus.SECURED,
        outputAsset: 'BTC',
        transactions: [
          ...[...new Array(11)].map((_, i) =>
            createCustomBuyCrypto({
              txId: null,
              buy: createCustomBuy({ user: createCustomUser({ address: `ADDR_${i}` }) }),
            }),
          ),
          createCustomBuyCrypto({
            txId: null,
            buy: createCustomBuy({ user: createCustomUser({ address: `ADDR_1` }) }),
          }),
        ],
      });

      expect(entity.transactions.length).toBe(12);

      const groups = entity.groupPayoutTransactions();

      expect(groups.length).toBe(2);
      expect(groups[0].length).toBe(10);
      expect(groups[1].length).toBe(2);
    });

    it('separates transactions with duplicated address into separate groups', () => {
      const entity = createCustomBuyCryptoBatch({
        status: BuyCryptoBatchStatus.SECURED,
        outputAsset: 'BTC',
        transactions: [
          ...[...new Array(11)].map((_, i) =>
            createCustomBuyCrypto({
              txId: null,
              buy: createCustomBuy({ user: createCustomUser({ address: `ADDR_${i}` }) }),
            }),
          ),
          createCustomBuyCrypto({
            txId: null,
            buy: createCustomBuy({ user: createCustomUser({ address: `ADDR_1` }) }),
          }),
        ],
      });

      const groups = entity.groupPayoutTransactions();

      expect(groups.length).toBe(2);
      expect(groups[0].filter((t) => t.buy.user.address === 'ADDR_1').length).toBe(1);
      expect(groups[1].filter((t) => t.buy.user.address === 'ADDR_1').length).toBe(1);
    });

    it('creates 3 separate groups for transactions with duplicated addresses', () => {
      const entity = createCustomBuyCryptoBatch({
        status: BuyCryptoBatchStatus.SECURED,
        outputAsset: 'BTC',
        transactions: [
          createCustomBuyCrypto({
            txId: null,
            buy: createCustomBuy({ user: createCustomUser({ address: `ADDR_1` }) }),
          }),
          createCustomBuyCrypto({
            txId: null,
            buy: createCustomBuy({ user: createCustomUser({ address: `ADDR_1` }) }),
          }),
          createCustomBuyCrypto({
            txId: null,
            buy: createCustomBuy({ user: createCustomUser({ address: `ADDR_1` }) }),
          }),
          createCustomBuyCrypto({
            txId: null,
            buy: createCustomBuy({ user: createCustomUser({ address: `ADDR_2` }) }),
          }),
        ],
      });

      const groups = entity.groupPayoutTransactions();

      expect(groups.length).toBe(3);
      expect(groups[0].length).toBe(2);
      expect(groups[0].filter((t) => t.buy.user.address === 'ADDR_1').length).toBe(1);
      expect(groups[1].length).toBe(1);
      expect(groups[1].filter((t) => t.buy.user.address === 'ADDR_1').length).toBe(1);
      expect(groups[2].length).toBe(1);
      expect(groups[2].filter((t) => t.buy.user.address === 'ADDR_1').length).toBe(1);
    });
  });
});
