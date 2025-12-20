import { Test } from '@nestjs/testing';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { TestUtil } from 'src/shared/utils/test.util';
import { Util } from 'src/shared/utils/util';
import { createCustomBuy } from 'src/subdomains/core/buy-crypto/routes/buy/__mocks__/buy.entity.mock';
import { createCustomUser } from 'src/subdomains/generic/user/models/user/__mocks__/user.entity.mock';
import { MissingBuyCryptoLiquidityException } from '../../exceptions/abort-batch-creation.exception';
import { createCustomBuyCryptoBatch, createDefaultBuyCryptoBatch } from '../__mocks__/buy-crypto-batch.entity.mock';
import { createCustomBuyCryptoFee } from '../__mocks__/buy-crypto-fee.entity.mock';
import { createCustomBuyCrypto, createDefaultBuyCrypto } from '../__mocks__/buy-crypto.entity.mock';
import { BuyCryptoBatch, BuyCryptoBatchStatus } from '../buy-crypto-batch.entity';

describe('BuyCryptoBatch', () => {
  beforeEach(async () => {
    await Test.createTestingModule({
      providers: [TestUtil.provideConfig()],
    }).compile();
  });

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
      expect(entity.transactions.length).toBe(0);

      entity.addTransaction(createDefaultBuyCrypto());

      expect(Array.isArray(entity.transactions)).toBe(true);
      expect(entity.transactions.length).toBe(1);
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

      const isPurchaseRequired = batch.optimizeByLiquidity(112, 0);

      expect(isPurchaseRequired).toBe(false);
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

      const isPurchaseRequired = batch.optimizeByLiquidity(5, 0);

      expect(isPurchaseRequired).toBe(false);
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

      const isPurchaseRequired = batch.optimizeByLiquidity(0.5, 11 * 1.05);

      expect(isPurchaseRequired).toBe(true);
    });

    it('aborts the batch if purchasable liquidity is not enough even for one tx', () => {
      const batch = createDiverseBuyCryptoBatch();

      const testCall = () => batch.optimizeByLiquidity(0.5, 0.5);

      expect(testCall).toThrow();
      expect(testCall).toThrowError(MissingBuyCryptoLiquidityException);
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

      const isPurchaseRequired = batch.optimizeByLiquidity(0.5, 10000);

      expect(isPurchaseRequired).toBe(true);
    });

    it('prioritizes transactions with liquidityPipeline over transactions without', () => {
      const batch = createBatchWithPipelinePriority();
      // Batch has: TX1 (1.0, pipeline 5), TX2 (0.4, no pipeline), TX3 (0.5, pipeline 3)
      // Total: 1.9, Available: 0.6

      batch.optimizeByLiquidity(0.6, 0);

      // TX3 (0.5, pipeline 3) should be selected - it has pipeline and fits
      // TX1 (1.0, pipeline 5) has pipeline but doesn't fit alone
      // TX2 (0.4, no pipeline) is skipped because TX3 with pipeline takes priority
      expect(batch.transactions.length).toBe(1);
      expect(batch.transactions[0].id).toBe(3);
      expect(batch.transactions[0].outputReferenceAmount).toBe(0.5);
      expect(batch.outputReferenceAmount).toBe(0.5);
    });

    it('prioritizes smaller pipeline ID when multiple transactions have pipelines', () => {
      const batch = createBatchWithPipelinePriority();
      // Batch has: TX1 (1.0, pipeline 5), TX2 (0.4, no pipeline), TX3 (0.5, pipeline 3)
      // Total: 1.9, Available: 1.6

      batch.optimizeByLiquidity(1.6, 0);

      // Both pipeline TXs fit together (0.5 + 1.0 = 1.5 <= 1.6)
      // TX3 (pipeline 3) comes first, then TX1 (pipeline 5)
      expect(batch.transactions.length).toBe(2);
      expect(batch.transactions[0].id).toBe(3); // pipeline 3 first
      expect(batch.transactions[1].id).toBe(1); // pipeline 5 second
      expect(batch.outputReferenceAmount).toBe(1.5);
    });

    it('does not re-batch when liquidity is sufficient for entire batch', () => {
      const batch = createBatchWithPipelinePriority();
      // Batch has: TX1 (1.0, pipeline 5), TX2 (0.4, no pipeline), TX3 (0.5, pipeline 3)
      // Total: 1.9, Available: 2.0

      batch.optimizeByLiquidity(2.0, 0);

      // When enough liquidity available, all transactions are kept (no re-batching needed)
      // Order is preserved from creation
      expect(batch.transactions.length).toBe(3);
      expect(batch.outputReferenceAmount).toBe(1.9);
    });

    it('stops adding transactions when next sorted transaction exceeds limit', () => {
      const batch = createBatchWithPipelinePriority();
      // Batch has: TX1 (1.0, pipeline 5), TX2 (0.4, no pipeline), TX3 (0.5, pipeline 3)
      // Total: 1.9, Available: 0.95

      batch.optimizeByLiquidity(0.95, 0);

      // Sorted order: TX3 (0.5, pipeline 3), TX1 (1.0, pipeline 5), TX2 (0.4, no pipeline)
      // TX3 (0.5) fits, running total = 0.5
      // TX1 (1.0) would make total 1.5 > 0.95, so algorithm stops (greedy approach)
      // TX2 is not considered because algorithm breaks when a TX doesn't fit
      expect(batch.transactions.length).toBe(1);
      expect(batch.transactions[0].id).toBe(3);
      expect(batch.outputReferenceAmount).toBe(0.5);
    });
  });

  describe('#optimizeByPayoutFeeEstimation(...)', () => {
    it('kicks out transactions if fee is too high', () => {
      const batch = createDiverseBuyCryptoBatch();

      batch.transactions.forEach((tx) => tx.fee.addPayoutFeeEstimation(0.1, tx));

      expect(batch.transactions.length).toBe(3);

      const filteredOutTransactions = batch.optimizeByPayoutFeeEstimation();

      expect(batch.transactions.length).toBe(2);
      expect(batch.transactions[0].outputReferenceAmount).toBe(100);
      expect(batch.transactions[1].outputReferenceAmount).toBe(10);

      expect(filteredOutTransactions.length).toBe(1);
      expect(filteredOutTransactions[0].outputReferenceAmount).toBe(1);

      expect(batch.outputReferenceAmount).toBe(110);
    });
  });

  describe('#checkByPurchaseFeeEstimation(...)', () => {
    it('assigns fee proportions by transaction volume', () => {
      const batch = createDiverseBuyCryptoBatch();

      batch.checkByPurchaseFeeEstimation(0.00003);

      expect(batch.transactions[0].fee.estimatePurchaseFeeAmount).toBe(0.00002703);
      expect(batch.transactions[1].fee.estimatePurchaseFeeAmount).toBe(0.0000027);
      expect(batch.transactions[2].fee.estimatePurchaseFeeAmount).toBe(0.00000027);
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

    it('throws error if sum of tx outputAmount and batch total outputAmount differs more than threshold', () => {
      const transactionA = createCustomBuyCrypto({ outputAmount: undefined, outputReferenceAmount: 10 });
      const transactionB = createCustomBuyCrypto({ outputAmount: undefined, outputReferenceAmount: 10 });
      const entity = createCustomBuyCryptoBatch({
        transactions: [transactionA, transactionB],
        outputReferenceAmount: 30,
        outputAsset: createCustomAsset({ dexName: 'BTC' }),
      });

      const testCall = () => entity.secure(30, 0);

      expect(testCall).toThrow();
      expect(testCall).toThrowError('Mismatch is too high. Mismatch: 10');
    });
  });

  describe('#complete(...)', () => {
    it('sets a status to COMPLETE', () => {
      const entity = createCustomBuyCryptoBatch({ status: undefined });

      expect(entity.status).toBeUndefined();

      entity.complete();

      expect(entity.status).toBe(BuyCryptoBatchStatus.COMPLETE);
    });
  });

  describe('#payingOut(...)', () => {
    it('sets a status to PAYING_OUT', () => {
      const entity = createCustomBuyCryptoBatch({ status: undefined });

      expect(entity.status).toBeUndefined();

      entity.payingOut();

      expect(entity.status).toBe(BuyCryptoBatchStatus.PAYING_OUT);
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
      createCustomBuyCrypto({
        id: 1,
        outputReferenceAmount: 100,
        fee: createCustomBuyCryptoFee({ allowedTotalFeeAmount: 0.2 }),
      }),
      createCustomBuyCrypto({
        id: 2,
        outputReferenceAmount: 10,
        fee: createCustomBuyCryptoFee({ allowedTotalFeeAmount: 0.5 }),
      }),
      createCustomBuyCrypto({
        id: 3,
        outputReferenceAmount: 1,
        fee: createCustomBuyCryptoFee({ allowedTotalFeeAmount: 0.01 }),
      }),
    ],
  });
}

function createBatchWithPipelinePriority(): BuyCryptoBatch {
  return createCustomBuyCryptoBatch({
    id: undefined,
    created: undefined,
    outputReferenceAmount: 1.9,
    transactions: [
      createCustomBuyCrypto({
        id: 1,
        outputReferenceAmount: 1,
        liquidityPipeline: { id: 5 } as any,
        fee: createCustomBuyCryptoFee({ allowedTotalFeeAmount: 0.5 }),
      }),
      createCustomBuyCrypto({
        id: 2,
        outputReferenceAmount: 0.4,
        liquidityPipeline: undefined,
        fee: createCustomBuyCryptoFee({ allowedTotalFeeAmount: 0.5 }),
      }),
      createCustomBuyCrypto({
        id: 3,
        outputReferenceAmount: 0.5,
        liquidityPipeline: { id: 3 } as any,
        fee: createCustomBuyCryptoFee({ allowedTotalFeeAmount: 0.5 }),
      }),
    ],
  });
}
