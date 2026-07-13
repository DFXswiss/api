import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import {
  createCustomPayoutOrder,
  createDefaultPayoutOrder,
} from '../../../entities/__mocks__/payout-order.entity.mock';
import { PayoutOrder, PayoutOrderContext, PayoutOrderStatus } from '../../../entities/payout-order.entity';
import { PayoutBroadcastException } from '../../../exceptions/payout-broadcast.exception';
import { FeeResult } from '../../../interfaces';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutBitcoinBasedService, PayoutGroup } from '../../../services/base/payout-bitcoin-based.service';
import { BitcoinBasedStrategy } from '../impl/base/bitcoin-based.strategy';

describe('PayoutBitcoinBasedStrategy', () => {
  let strategy: PayoutBitcoinBasedStrategyWrapper;

  let notificationService: NotificationService;
  let payoutOrderRepo: PayoutOrderRepository;
  let bitcoinService: PayoutBitcoinBasedService;

  let repoSaveSpy: jest.SpyInstance;
  let sendErrorMailSpy: jest.SpyInstance;

  beforeEach(() => {
    notificationService = mock<NotificationService>();
    payoutOrderRepo = mock<PayoutOrderRepository>();
    bitcoinService = mock<PayoutBitcoinBasedService>();

    repoSaveSpy = jest.spyOn(payoutOrderRepo, 'save');
    sendErrorMailSpy = jest.spyOn(notificationService, 'sendMail');

    strategy = new PayoutBitcoinBasedStrategyWrapper(notificationService, payoutOrderRepo, bitcoinService);
  });

  afterEach(() => {
    repoSaveSpy.mockClear();
    sendErrorMailSpy.mockClear();
  });

  describe('#createPayoutGroups(...)', () => {
    it('restricts grouping orders with different assets', () => {
      const orders = [
        createCustomPayoutOrder({ asset: createCustomAsset({ dexName: 'BTC' }) }),
        createCustomPayoutOrder({ asset: createCustomAsset({ dexName: 'ETH' }) }),
      ];

      const testCall = () => strategy.createPayoutGroupsWrapper(orders, 10);

      expect(testCall).toThrow();
      expect(testCall).toThrowError('Cannot group orders of different assets to same payout group');
    });

    it('restricts zero maxGroupSize', () => {
      const orders = [createDefaultPayoutOrder()];

      const testCall = () => strategy.createPayoutGroupsWrapper(orders, 0);

      expect(testCall).toThrow();
      expect(testCall).toThrowError('Max group size for payout cannot be 0');
    });

    it('returns array of arrays', () => {
      const orders = [createDefaultPayoutOrder()];

      const groups = strategy.createPayoutGroupsWrapper(orders, 10);

      expect(Array.isArray(groups)).toBe(true);
      expect(Array.isArray(groups[0])).toBe(true);
    });

    it('groups payouts to same address in same payout group', () => {
      const orders = [
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_02' }),
      ];

      const groups = strategy.createPayoutGroupsWrapper(orders, 10);

      expect(groups.length).toBe(1);
      expect(groups[0].length).toBe(3);
    });

    it('limits maximum amount of unique addresses per group', () => {
      const orders = [
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_02' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_03' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_04' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_05' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_06' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_07' }),
      ];

      const groups = strategy.createPayoutGroupsWrapper(orders, 4);

      expect(groups.length).toBe(2);
      expect(groups[0].length).toBe(4); // 4 unique addresses
      expect(groups[1].length).toBe(3); // 3 unique addresses
    });

    it('allows multiple orders to same address in one group', () => {
      const orders = [
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_02' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_02' }),
      ];

      const groups = strategy.createPayoutGroupsWrapper(orders, 2);

      expect(groups.length).toBe(1); // Only 2 unique addresses, fits in one group
      expect(groups[0].length).toBe(5); // All 5 orders in one group
    });

    it('splits groups when unique address limit is reached', () => {
      const orders = [
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01' }), // duplicate
        createCustomPayoutOrder({ destinationAddress: 'ADDR_02' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_03' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_04' }), // 4th unique address, exceeds limit
      ];

      const groups = strategy.createPayoutGroupsWrapper(orders, 3);

      expect(groups.length).toBe(2);
      expect(groups[0].length).toBe(4); // ADDR_01 (x2), ADDR_02, ADDR_03
      expect(groups[1].length).toBe(1); // ADDR_04
    });
  });

  describe('#aggregatePayout(...)', () => {
    it('reduces all orders to same address in one group for this address', () => {
      const orders = [
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_02' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_02' }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_02' }),
      ];

      const groups = strategy.aggregatePayoutWrapper(orders);

      expect(groups.length).toBe(2);
      expect(groups[0].addressTo).toBe('ADDR_01');
      expect(groups[1].addressTo).toBe('ADDR_02');
    });

    it('sums up all amounts to same address', () => {
      const orders = [
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01', amount: 1 }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01', amount: 2 }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01', amount: 3 }),
      ];

      const groups = strategy.aggregatePayoutWrapper(orders);

      expect(groups.length).toBe(1);
      expect(groups[0].addressTo).toBe('ADDR_01');
      expect(groups[0].amount).toBe(6);
    });

    it('rounds all final amounts to 8 digits', () => {
      const orders = [
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01', amount: 1.000000003 }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01', amount: 2.000000003 }),
        createCustomPayoutOrder({ destinationAddress: 'ADDR_01', amount: 3.000000003 }),
      ];

      const groups = strategy.aggregatePayoutWrapper(orders);

      expect(groups.length).toBe(1);
      expect(groups[0].addressTo).toBe('ADDR_01');
      expect(groups[0].amount).toBe(6.00000001);
    });
  });

  describe('#designatePayout(...)', () => {
    it('sets every order a PAYOUT_DESIGNATED status', async () => {
      const orders = [
        createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED }),
        createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED }),
        createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED }),
      ];

      await strategy.designatePayoutWrapper(orders);

      expect(orders.every((order) => order.status === PayoutOrderStatus.PAYOUT_DESIGNATED));
    });

    it('saves updated order to repo', async () => {
      const orders = [
        createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED }),
        createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED }),
        createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED }),
      ];

      await strategy.designatePayoutWrapper(orders);

      expect(repoSaveSpy).toBeCalledTimes(3);
    });
  });

  describe('#rollbackPayoutDesignation(...)', () => {
    it('rolls back every order to a PREPARATION_CONFIRMED status', async () => {
      const orders = [
        createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_DESIGNATED }),
        createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_DESIGNATED }),
        createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_DESIGNATED }),
      ];

      await strategy.rollbackPayoutDesignationWrapper(orders);

      expect(orders.every((order) => order.status === PayoutOrderStatus.PREPARATION_CONFIRMED));
    });

    it('saves updated order to repo', async () => {
      const orders = [
        createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED }),
        createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED }),
        createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED }),
      ];

      await strategy.rollbackPayoutDesignationWrapper(orders);

      expect(repoSaveSpy).toBeCalledTimes(3);
    });
  });

  describe('#send(...)', () => {
    it('completes the payout and resets retry tracking on a successful dispatch', async () => {
      const orders = [
        createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED, payoutTxId: null, retryCount: 2 }),
      ];
      strategy.dispatchPayoutImpl = () => Promise.resolve('CHAIN_TX_ID');

      await strategy.sendWrapper(PayoutOrderContext.BUY_CRYPTO, orders);

      expect(orders[0].status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
      expect(orders[0].payoutTxId).toBe('CHAIN_TX_ID');
      expect(orders[0].retryCount).toBe(0);
    });

    // The structural fix under test: only a PayoutBroadcastException (client reached the actual
    // on-chain broadcast call) must stay fail-closed. This replaces the old `e.message.includes
    // ('timeout')` string heuristic.
    it('keeps the order PAYOUT_DESIGNATED (fail-closed) when dispatchPayout throws a PayoutBroadcastException', async () => {
      const orders = [createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED, payoutTxId: null })];
      strategy.dispatchPayoutImpl = () => Promise.reject(new PayoutBroadcastException('node unreachable after send'));

      await expect(strategy.sendWrapper(PayoutOrderContext.BUY_CRYPTO, orders)).rejects.toBeInstanceOf(
        PayoutBroadcastException,
      );

      expect(orders[0].status).toBe(PayoutOrderStatus.PAYOUT_DESIGNATED);
    });

    it('rolls back to PREPARATION_CONFIRMED (self-heals) when dispatchPayout throws a plain Error', async () => {
      const orders = [createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED, payoutTxId: null })];
      strategy.dispatchPayoutImpl = () => Promise.reject(new Error('Invalid amount'));

      await strategy.sendWrapper(PayoutOrderContext.BUY_CRYPTO, orders);

      expect(orders[0].status).toBe(PayoutOrderStatus.PREPARATION_CONFIRMED);
    });

    // Regression test for the removed heuristic: a pre-broadcast RPC timeout (e.g. fee
    // estimation) is a plain Error and must now self-heal instead of incorrectly staying
    // fail-closed just because its message happens to contain the word "timeout".
    it('rolls back (self-heals) a pre-broadcast plain Error whose message contains "timeout"', async () => {
      const orders = [createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED, payoutTxId: null })];
      strategy.dispatchPayoutImpl = () => Promise.reject(new Error('RPC call timeout during fee estimation'));

      await strategy.sendWrapper(PayoutOrderContext.BUY_CRYPTO, orders);

      expect(orders[0].status).toBe(PayoutOrderStatus.PREPARATION_CONFIRMED);
    });

    it('stays fail-closed for a PayoutBroadcastException even without the word "timeout" in the message', async () => {
      const orders = [createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED, payoutTxId: null })];
      strategy.dispatchPayoutImpl = () => Promise.reject(new PayoutBroadcastException('connection reset'));

      await expect(strategy.sendWrapper(PayoutOrderContext.BUY_CRYPTO, orders)).rejects.toBeInstanceOf(
        PayoutBroadcastException,
      );

      expect(orders[0].status).toBe(PayoutOrderStatus.PAYOUT_DESIGNATED);
    });

    it('records the failure via trackPayoutFailure on both pre- and at-or-after-broadcast errors', async () => {
      const preBroadcastOrder = createCustomPayoutOrder({
        id: 20,
        status: PayoutOrderStatus.PREPARATION_CONFIRMED,
        payoutTxId: null,
      });
      const postBroadcastOrder = createCustomPayoutOrder({
        id: 21,
        status: PayoutOrderStatus.PREPARATION_CONFIRMED,
        payoutTxId: null,
      });

      strategy.dispatchPayoutImpl = () => Promise.reject(new Error('pre-broadcast failure'));
      await strategy.sendWrapper(PayoutOrderContext.BUY_CRYPTO, [preBroadcastOrder]);
      expect(preBroadcastOrder.retryCount).toBe(1);
      expect(preBroadcastOrder.lastError).toBe('pre-broadcast failure');

      strategy.dispatchPayoutImpl = () => Promise.reject(new PayoutBroadcastException('post-broadcast failure'));
      await expect(strategy.sendWrapper(PayoutOrderContext.BUY_CRYPTO, [postBroadcastOrder])).rejects.toBeInstanceOf(
        PayoutBroadcastException,
      );
      expect(postBroadcastOrder.retryCount).toBe(1);
      expect(postBroadcastOrder.lastError).toBe('post-broadcast failure');
    });
  });

  describe('#trackPayoutFailure(...)', () => {
    it('increments retryCount, persists lastError and lastAttemptDate on every order', async () => {
      const orders = [createCustomPayoutOrder({ id: 10 }), createCustomPayoutOrder({ id: 11 })];

      await strategy.trackPayoutFailureWrapper(orders, new Error('Bitcoin RPC send failed: Invalid amount'));

      expect(orders[0].retryCount).toBe(1);
      expect(orders[1].retryCount).toBe(1);
      expect(orders[0].lastError).toBe('Bitcoin RPC send failed: Invalid amount');
      expect(orders[0].lastAttemptDate).toBeInstanceOf(Date);
      expect(repoSaveSpy).toBeCalledTimes(2);
    });

    it('does not alert before the 5-attempt threshold', async () => {
      const orders = [createCustomPayoutOrder({ id: 10, retryCount: 3 })];

      await strategy.trackPayoutFailureWrapper(orders, new Error('Bitcoin RPC send failed: Invalid amount'));

      expect(orders[0].retryCount).toBe(4);
      expect(sendErrorMailSpy).not.toBeCalled();
    });

    it('fires the operator alert on the 5th attempt with 1h debounce (no suppressRecurring)', async () => {
      const orders = [createCustomPayoutOrder({ id: 10, retryCount: 4 })];

      await strategy.trackPayoutFailureWrapper(orders, new Error('Bitcoin RPC send failed: Invalid amount'));

      expect(orders[0].retryCount).toBe(5);
      expect(sendErrorMailSpy).toBeCalledTimes(1);
      expect(sendErrorMailSpy).toBeCalledWith(
        expect.objectContaining({
          type: 'ErrorMonitoring',
          context: 'Payout',
          // Notification.isSuppressed short-circuits on `suppressRecurring`, so
          // setting it would silence the debounce. Debounce alone gives the
          // desired "1 alert per group per hour" semantic.
          options: { debounce: 3600000 },
          correlationId: expect.stringContaining('PayoutOrderRecurringFailure'),
          input: expect.objectContaining({ isLiqMail: true }),
        }),
      );
    });

    it('builds a stable correlationId by sorting ids (PG row order is not guaranteed)', async () => {
      const orders = [
        createCustomPayoutOrder({ id: 20, retryCount: 4 }),
        createCustomPayoutOrder({ id: 11, retryCount: 4 }),
      ];

      await strategy.trackPayoutFailureWrapper(orders, new Error('Bitcoin RPC send failed: Invalid amount'));

      expect(sendErrorMailSpy).toBeCalledWith(
        expect.objectContaining({
          correlationId: expect.stringMatching(/PayoutOrderRecurringFailure&BuyCrypto&11-20$/),
        }),
      );
    });

    it('alerts on any single order over threshold (max semantic, not min)', async () => {
      // Existing failing order at retryCount=4 (about to trip), plus a fresh
      // order at retryCount=0 that joined this round. min would silence the
      // alert (0 < 5); max keeps the operator informed.
      const orders = [
        createCustomPayoutOrder({ id: 10, retryCount: 4 }),
        createCustomPayoutOrder({ id: 11, retryCount: 0 }),
      ];

      await strategy.trackPayoutFailureWrapper(orders, new Error('Bitcoin RPC send failed: Invalid amount'));

      expect(orders[0].retryCount).toBe(5);
      expect(orders[1].retryCount).toBe(1);
      expect(sendErrorMailSpy).toBeCalledTimes(1);
    });

    it('returns early without saving or alerting on an empty orders array', async () => {
      await strategy.trackPayoutFailureWrapper([], new Error('whatever'));

      expect(repoSaveSpy).not.toBeCalled();
      expect(sendErrorMailSpy).not.toBeCalled();
    });

    it('truncates very long error messages to 2048 chars', async () => {
      const longError = 'X'.repeat(5000);
      const orders = [createCustomPayoutOrder({ id: 10 })];

      await strategy.trackPayoutFailureWrapper(orders, new Error(longError));

      expect(orders[0].lastError?.length).toBe(2048);
    });
  });

  describe('#resetPayoutRetry(...)', () => {
    it('clears retryCount, lastError and lastAttemptDate on a previously failing order', () => {
      const order = createCustomPayoutOrder({ id: 10, retryCount: 7 });
      order.lastError = 'Bitcoin RPC send failed: Invalid amount';
      order.lastAttemptDate = new Date();

      order.resetPayoutRetry();

      expect(order.retryCount).toBe(0);
      expect(order.lastError).toBeNull();
      expect(order.lastAttemptDate).toBeNull();
    });
  });

  describe('#sendNonRecoverableErrorMailWrapper(...)', () => {
    it('combines custom message with error message', async () => {
      await strategy.sendNonRecoverableErrorMailWrapper(
        createDefaultPayoutOrder(),
        'Test message',
        new Error('Another message'),
      );

      expect(sendErrorMailSpy).toBeCalledTimes(1);
      expect(sendErrorMailSpy).toBeCalledWith({
        input: { errors: ['Test message', 'Another message'], subject: 'Payout Error', isLiqMail: true },
        type: 'ErrorMonitoring',
        context: 'Payout',
        correlationId: 'PayoutOrder&BuyCrypto&1',
        options: {
          suppressRecurring: true,
        },
      });
    });

    it('calls notificationService with Payout Error subject', async () => {
      await strategy.sendNonRecoverableErrorMailWrapper(createDefaultPayoutOrder(), '');

      expect(sendErrorMailSpy).toBeCalledTimes(1);
      expect(sendErrorMailSpy).toBeCalledWith({
        input: { errors: [''], subject: 'Payout Error', isLiqMail: true },
        type: 'ErrorMonitoring',
        context: 'Payout',
        correlationId: 'PayoutOrder&BuyCrypto&1',
        options: {
          suppressRecurring: true,
        },
      });
    });
  });
});

class PayoutBitcoinBasedStrategyWrapper extends BitcoinBasedStrategy {
  protected readonly logger = new DfxLogger(PayoutBitcoinBasedStrategyWrapper);

  constructor(
    notificationService: NotificationService,
    payoutOrderRepo: PayoutOrderRepository,
    bitcoinService: PayoutBitcoinBasedService,
  ) {
    super(notificationService, payoutOrderRepo, bitcoinService);
  }

  get blockchain(): Blockchain {
    return Blockchain.BITCOIN;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected doPayoutForContext(): Promise<void> {
    throw new Error('Method not implemented.');
  }

  // Overridable per-test so #send(...) tests can simulate pre-broadcast vs. at-or-after-broadcast
  // failures without needing a real chain client.
  dispatchPayoutImpl: (context: PayoutOrderContext, payout: PayoutGroup, token?: Asset) => Promise<string> = () =>
    Promise.resolve('TX_ID_01');

  protected async dispatchPayout(context: PayoutOrderContext, payout: PayoutGroup, token?: Asset): Promise<string> {
    return this.dispatchPayoutImpl(context, payout, token);
  }

  sendWrapper(context: PayoutOrderContext, orders: PayoutOrder[]) {
    return this.send(context, orders);
  }

  createPayoutGroupsWrapper(orders: PayoutOrder[], maxGroupSize: number) {
    return this.createPayoutGroups(orders, maxGroupSize);
  }

  aggregatePayoutWrapper(orders: PayoutOrder[]) {
    return this.aggregatePayout(orders);
  }

  designatePayoutWrapper(orders: PayoutOrder[]) {
    return this.designatePayout(orders);
  }

  rollbackPayoutDesignationWrapper(orders: PayoutOrder[]) {
    return this.rollbackPayoutDesignation(orders);
  }

  sendNonRecoverableErrorMailWrapper(order: PayoutOrder, message: string, e?: Error) {
    return this.sendNonRecoverableErrorMail(order, message, e);
  }

  trackPayoutFailureWrapper(orders: PayoutOrder[], error: Error) {
    return this.trackPayoutFailure(orders, error);
  }

  estimateFee(): Promise<FeeResult> {
    throw new Error('Method not implemented.');
  }

  protected getFeeAsset(): Promise<Asset> {
    throw new Error('Method not implemented.');
  }
}
