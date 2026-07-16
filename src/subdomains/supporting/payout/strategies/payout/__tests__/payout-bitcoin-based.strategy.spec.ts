import { mock } from 'jest-mock-extended';
import { Config, ConfigService } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset, createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import * as processServiceModule from 'src/shared/services/process.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import {
  PriceCurrency,
  PriceValidity,
  PricingService,
} from 'src/subdomains/supporting/pricing/services/pricing.service';
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

  let repoUpdateSpy: jest.SpyInstance;
  let repoSaveSpy: jest.SpyInstance;
  let sendErrorMailSpy: jest.SpyInstance;

  beforeEach(() => {
    new ConfigService();
    Config.payout.maxPreBroadcastRetries = 3;

    notificationService = mock<NotificationService>();
    payoutOrderRepo = mock<PayoutOrderRepository>();
    bitcoinService = mock<PayoutBitcoinBasedService>();

    repoUpdateSpy = jest.spyOn(payoutOrderRepo, 'update').mockResolvedValue({ affected: 1 } as any);
    repoSaveSpy = jest.spyOn(payoutOrderRepo, 'save');
    sendErrorMailSpy = jest.spyOn(notificationService, 'sendMail');

    strategy = new PayoutBitcoinBasedStrategyWrapper(notificationService, payoutOrderRepo, bitcoinService);
  });

  afterEach(() => {
    repoUpdateSpy.mockClear();
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
    it('returns and designates every order whose conditional update succeeds', async () => {
      const orders = [
        createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED }),
        createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED }),
        createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED }),
      ];

      const designated = await strategy.designatePayoutWrapper(orders);

      expect(designated).toEqual(orders);
      expect(orders.every((order) => order.status === PayoutOrderStatus.PAYOUT_DESIGNATED)).toBe(true);
      expect(repoUpdateSpy).toHaveBeenCalledTimes(3);
    });

    it('uses the exact conditional status transition without saving a stale entity', async () => {
      const order = createCustomPayoutOrder({ id: 42, status: PayoutOrderStatus.PREPARATION_CONFIRMED });

      await strategy.designatePayoutWrapper([order]);

      expect(repoUpdateSpy).toHaveBeenCalledWith(
        { id: order.id, status: PayoutOrderStatus.PREPARATION_CONFIRMED },
        { status: PayoutOrderStatus.PAYOUT_DESIGNATED },
      );
      expect(repoSaveSpy).not.toHaveBeenCalled();
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

    it('dispatches only winners when one order loses the designation race', async () => {
      const asset = createCustomAsset({ name: 'BTC' });
      const orders = [
        createCustomPayoutOrder({
          id: 50,
          asset,
          status: PayoutOrderStatus.PREPARATION_CONFIRMED,
          destinationAddress: 'WINNER_1',
          amount: 1,
        }),
        createCustomPayoutOrder({
          id: 51,
          asset,
          status: PayoutOrderStatus.PREPARATION_CONFIRMED,
          destinationAddress: 'LOSER',
          amount: 2,
        }),
        createCustomPayoutOrder({
          id: 52,
          asset,
          status: PayoutOrderStatus.PREPARATION_CONFIRMED,
          destinationAddress: 'WINNER_2',
          amount: 3,
        }),
      ];
      repoUpdateSpy
        .mockResolvedValueOnce({ affected: 1 } as any)
        .mockResolvedValueOnce({ affected: 0 } as any)
        .mockResolvedValueOnce({ affected: 1 } as any);
      const dispatchSpy = jest.fn().mockResolvedValue('CHAIN_TX_ID');
      strategy.dispatchPayoutImpl = dispatchSpy;

      await strategy.sendWrapper(PayoutOrderContext.BUY_CRYPTO, orders);

      expect(dispatchSpy).toHaveBeenCalledWith(
        PayoutOrderContext.BUY_CRYPTO,
        [
          { addressTo: 'WINNER_1', amount: 1 },
          { addressTo: 'WINNER_2', amount: 3 },
        ],
        asset,
      );
      expect(dispatchSpy).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([{ addressTo: 'LOSER', amount: 2 }]),
        expect.anything(),
      );
      expect(orders[0].status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
      expect(orders[1].status).toBe(PayoutOrderStatus.PREPARATION_CONFIRMED);
      expect(orders[2].status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
      expect(repoSaveSpy).toHaveBeenCalledTimes(2);
      expect(repoSaveSpy).not.toHaveBeenCalledWith(orders[1]);
    });

    it('skips a failed designation update and still dispatches the other winners', async () => {
      const asset = createCustomAsset({ name: 'BTC' });
      const orders = [
        createCustomPayoutOrder({
          id: 53,
          asset,
          status: PayoutOrderStatus.PREPARATION_CONFIRMED,
          destinationAddress: 'WINNER_1',
          amount: 1,
        }),
        createCustomPayoutOrder({
          id: 54,
          asset,
          status: PayoutOrderStatus.PREPARATION_CONFIRMED,
          destinationAddress: 'FAILED_CLAIM',
          amount: 2,
        }),
        createCustomPayoutOrder({
          id: 55,
          asset,
          status: PayoutOrderStatus.PREPARATION_CONFIRMED,
          destinationAddress: 'WINNER_2',
          amount: 3,
        }),
      ];
      repoUpdateSpy
        .mockResolvedValueOnce({ affected: 1 } as any)
        .mockRejectedValueOnce(new Error('database unavailable'))
        .mockResolvedValueOnce({ affected: 1 } as any);
      const dispatchSpy = jest.fn().mockResolvedValue('CHAIN_TX_ID');
      strategy.dispatchPayoutImpl = dispatchSpy;

      await expect(strategy.sendWrapper(PayoutOrderContext.BUY_CRYPTO, orders)).resolves.toBeUndefined();

      expect(dispatchSpy).toHaveBeenCalledWith(
        PayoutOrderContext.BUY_CRYPTO,
        [
          { addressTo: 'WINNER_1', amount: 1 },
          { addressTo: 'WINNER_2', amount: 3 },
        ],
        asset,
      );
      expect(orders[0].status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
      expect(orders[1].status).toBe(PayoutOrderStatus.PREPARATION_CONFIRMED);
      expect(orders[2].status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
      expect(repoSaveSpy).toHaveBeenCalledTimes(2);
      expect(repoSaveSpy).not.toHaveBeenCalledWith(orders[1]);
    });

    it('does not dispatch or save when every order loses the designation race', async () => {
      const orders = [
        createCustomPayoutOrder({ id: 60, status: PayoutOrderStatus.PREPARATION_CONFIRMED }),
        createCustomPayoutOrder({ id: 61, status: PayoutOrderStatus.PREPARATION_CONFIRMED }),
      ];
      repoUpdateSpy.mockResolvedValue({ affected: 0 } as any);
      const dispatchSpy = jest.fn().mockResolvedValue('CHAIN_TX_ID');
      strategy.dispatchPayoutImpl = dispatchSpy;

      await strategy.sendWrapper(PayoutOrderContext.BUY_CRYPTO, orders);

      expect(repoUpdateSpy).toHaveBeenCalledTimes(2);
      expect(dispatchSpy).not.toHaveBeenCalled();
      expect(repoSaveSpy).not.toHaveBeenCalled();
      expect(orders.every((order) => order.status === PayoutOrderStatus.PREPARATION_CONFIRMED)).toBe(true);
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

    it('tracks and rolls back only claim winners when dispatch throws a plain Error', async () => {
      const winners = [
        createCustomPayoutOrder({ id: 70, status: PayoutOrderStatus.PREPARATION_CONFIRMED, payoutTxId: null }),
        createCustomPayoutOrder({ id: 72, status: PayoutOrderStatus.PREPARATION_CONFIRMED, payoutTxId: null }),
      ];
      const loser = createCustomPayoutOrder({
        id: 71,
        status: PayoutOrderStatus.PREPARATION_CONFIRMED,
        payoutTxId: null,
      });
      const orders = [winners[0], loser, winners[1]];
      repoUpdateSpy
        .mockResolvedValueOnce({ affected: 1 } as any)
        .mockResolvedValueOnce({ affected: 0 } as any)
        .mockResolvedValueOnce({ affected: 1 } as any);
      strategy.dispatchPayoutImpl = () => Promise.reject(new Error('pre-broadcast failure'));
      const trackSpy = jest.spyOn(strategy as any, 'trackPayoutFailure');
      const rollbackSpy = jest.spyOn(strategy as any, 'rollbackPayoutDesignation');

      await strategy.sendWrapper(PayoutOrderContext.BUY_CRYPTO, orders);

      expect(trackSpy).toHaveBeenCalledTimes(1);
      expect(trackSpy).toHaveBeenCalledWith(winners, expect.any(Error));
      expect(rollbackSpy).toHaveBeenCalledTimes(1);
      expect(rollbackSpy).toHaveBeenCalledWith(winners);
      expect(loser.status).toBe(PayoutOrderStatus.PREPARATION_CONFIRMED);
      expect(loser.retryCount).toBe(0);
      expect(loser.lastError).toBeUndefined();
      expect(repoSaveSpy).not.toHaveBeenCalledWith(loser);
    });

    it('rolls back and saves a pre-broadcast failure at the configured retry cap', async () => {
      const order = createCustomPayoutOrder({
        id: 50,
        status: PayoutOrderStatus.PREPARATION_CONFIRMED,
        payoutTxId: null,
        retryCount: Config.payout.maxPreBroadcastRetries - 1,
      });
      const rollbackSpy = jest.spyOn(order, 'rollbackPayoutDesignation');
      strategy.dispatchPayoutImpl = () => Promise.reject(new Error('deterministic pre-broadcast failure'));

      await strategy.sendWrapper(PayoutOrderContext.BUY_CRYPTO, [order]);

      expect(order.retryCount).toBe(Config.payout.maxPreBroadcastRetries);
      expect(order.status).toBe(PayoutOrderStatus.PREPARATION_CONFIRMED);
      expect(rollbackSpy).toHaveBeenCalledTimes(1);
      expect(repoSaveSpy).toHaveBeenCalledTimes(3); // designation, failure tracking, rollback
    });

    it('does not roll back above the pre-broadcast retry cap and warns before escalation', async () => {
      const order = createCustomPayoutOrder({
        id: 51,
        status: PayoutOrderStatus.PREPARATION_CONFIRMED,
        payoutTxId: null,
        retryCount: Config.payout.maxPreBroadcastRetries,
      });
      const rollbackSpy = jest.spyOn(order, 'rollbackPayoutDesignation');
      const loggerWarnSpy = jest.spyOn((strategy as any).logger, 'warn');
      strategy.dispatchPayoutImpl = () => Promise.reject(new Error('deterministic pre-broadcast failure'));

      await strategy.sendWrapper(PayoutOrderContext.BUY_CRYPTO, [order]);

      expect(order.retryCount).toBe(Config.payout.maxPreBroadcastRetries + 1);
      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_DESIGNATED);
      expect(rollbackSpy).not.toHaveBeenCalled();
      expect(repoSaveSpy).toHaveBeenCalledTimes(2); // designation and failure tracking only
      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('retry cap 3 exceeded for order(s) 51'));
    });

    // A misconfigured NaN cap makes every `retryCount <= cap` comparison false, so the negated
    // partition routes all orders into the fail-closed branch (no silent self-heal under bad config).
    it('does not roll back when the retry cap is NaN and warns for all orders', async () => {
      Config.payout.maxPreBroadcastRetries = NaN;
      const orders = [
        createCustomPayoutOrder({ id: 60, status: PayoutOrderStatus.PREPARATION_CONFIRMED, payoutTxId: null }),
        createCustomPayoutOrder({ id: 61, status: PayoutOrderStatus.PREPARATION_CONFIRMED, payoutTxId: null }),
      ];
      const rollbackSpies = orders.map((order) => jest.spyOn(order, 'rollbackPayoutDesignation'));
      const loggerWarnSpy = jest.spyOn((strategy as any).logger, 'warn');
      strategy.dispatchPayoutImpl = () => Promise.reject(new Error('deterministic pre-broadcast failure'));

      await strategy.sendWrapper(PayoutOrderContext.BUY_CRYPTO, orders);

      expect(orders.every((order) => order.status === PayoutOrderStatus.PAYOUT_DESIGNATED)).toBe(true);
      for (const spy of rollbackSpies) expect(spy).not.toHaveBeenCalled();
      expect(repoSaveSpy).toHaveBeenCalledTimes(4); // designation + failure tracking only (2 each)
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('retry cap NaN exceeded for order(s) 60, 61'),
      );
    });

    it('still fires the recurring-failure alert at its threshold when the retry cap is configured above it', async () => {
      Config.payout.maxPreBroadcastRetries = 6;
      const order = createCustomPayoutOrder({
        id: 52,
        status: PayoutOrderStatus.PREPARATION_CONFIRMED,
        payoutTxId: null,
        retryCount: 4,
      });
      strategy.dispatchPayoutImpl = () => Promise.reject(new Error('deterministic pre-broadcast failure'));

      await strategy.sendWrapper(PayoutOrderContext.BUY_CRYPTO, [order]);

      expect(order.retryCount).toBe(5);
      expect(order.status).toBe(PayoutOrderStatus.PREPARATION_CONFIRMED);
      expect(sendErrorMailSpy).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: expect.stringContaining('PayoutOrderRecurringFailure') }),
      );
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

    it('throws (without persisting) when an order already has a payoutTxId and TX_SPEEDUP is enabled', async () => {
      // speedup would reuse an existing txId; the Bitcoin path does not implement it, so it must
      // fail-fast before touching the repo. DisabledProcess defaults to true (fail-closed) in tests,
      // so force it false to make `!DisabledProcess(TX_SPEEDUP)` true and reach the guard.
      const disabledSpy = jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(false);
      const orders = [
        createCustomPayoutOrder({ id: 40, status: PayoutOrderStatus.PAYOUT_DESIGNATED, payoutTxId: 'EXISTING_TX' }),
      ];

      await expect(strategy.sendWrapper(PayoutOrderContext.BUY_CRYPTO, orders)).rejects.toThrowError(
        'Transaction speedup is not implemented for Bitcoin',
      );
      expect(repoSaveSpy).not.toHaveBeenCalled();

      disabledSpy.mockRestore();
    });

    it('does not trip the speedup guard when TX_SPEEDUP is disabled, even if an order has a payoutTxId', async () => {
      // Default test env: DisabledProcess(TX_SPEEDUP) === true, so `!DisabledProcess(...)` is false and
      // the guard is skipped; the order is dispatched through the standard path.
      const order = createCustomPayoutOrder({
        id: 41,
        status: PayoutOrderStatus.PREPARATION_CONFIRMED,
        payoutTxId: 'PTX_EXISTING',
      });
      strategy.dispatchPayoutImpl = () => Promise.resolve('CHAIN_TX_ID');
      repoSaveSpy.mockImplementation(async (o: PayoutOrder) => o as PayoutOrder);

      await strategy.sendWrapper(PayoutOrderContext.BUY_CRYPTO, [order]);

      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
      expect(order.payoutTxId).toBe('CHAIN_TX_ID');
    });

    it('sends a non-recoverable error mail when persisting the paid order fails after a successful dispatch', async () => {
      const order = createCustomPayoutOrder({
        id: 30,
        status: PayoutOrderStatus.PREPARATION_CONFIRMED,
        payoutTxId: null,
      });
      strategy.dispatchPayoutImpl = () => Promise.resolve('CHAIN_TX_ID');
      // Designation uses the conditional update; the final PAYOUT_PENDING save fails.
      repoSaveSpy.mockImplementation(async (o: PayoutOrder) => {
        if (o.status === PayoutOrderStatus.PAYOUT_PENDING) throw new Error('db down');
        return o;
      });
      const loggerErrorSpy = jest.spyOn((strategy as any).logger, 'error');

      await strategy.sendWrapper(PayoutOrderContext.BUY_CRYPTO, [order]);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error on saving payout payoutTxId to the database'),
        expect.any(Error),
      );
      expect(sendErrorMailSpy).toHaveBeenCalledTimes(1);
      expect(sendErrorMailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ErrorMonitoring',
          context: 'Payout',
          correlationId: 'PayoutOrder&BuyCrypto&30',
          input: expect.objectContaining({ subject: 'Payout Error', isLiqMail: true }),
          options: { suppressRecurring: true },
        }),
      );
    });
  });

  describe('#estimateBlockchainFee(...)', () => {
    it('delegates to estimateFee(...) with the given asset', async () => {
      const asset = createCustomAsset({ id: 7 });
      const feeResult: FeeResult = { asset: createDefaultAsset(), amount: 0.5 };
      strategy.estimateFeeImpl = () => Promise.resolve(feeResult);
      const estimateFeeSpy = jest.spyOn(strategy, 'estimateFee');

      const result = await strategy.estimateBlockchainFee(asset);

      expect(result).toBe(feeResult);
      expect(estimateFeeSpy).toHaveBeenCalledWith(asset);
    });
  });

  describe('#doPayout(...)', () => {
    it('groups orders by context and dispatches each healthy context to doPayoutForContext(...)', async () => {
      const buyCryptoOrders = [
        createCustomPayoutOrder({ id: 1, context: PayoutOrderContext.BUY_CRYPTO }),
        createCustomPayoutOrder({ id: 2, context: PayoutOrderContext.BUY_CRYPTO }),
      ];
      const manualOrder = createCustomPayoutOrder({ id: 3, context: PayoutOrderContext.MANUAL });
      jest.spyOn(bitcoinService, 'isHealthy').mockResolvedValue(true);
      const doPayoutForContextSpy = jest.spyOn(strategy, 'doPayoutForContextImpl');

      await strategy.doPayout([...buyCryptoOrders, manualOrder]);

      expect(bitcoinService.isHealthy).toHaveBeenCalledWith(PayoutOrderContext.BUY_CRYPTO);
      expect(bitcoinService.isHealthy).toHaveBeenCalledWith(PayoutOrderContext.MANUAL);
      expect(doPayoutForContextSpy).toHaveBeenCalledTimes(2);
      expect(doPayoutForContextSpy).toHaveBeenCalledWith(PayoutOrderContext.BUY_CRYPTO, buyCryptoOrders);
      expect(doPayoutForContextSpy).toHaveBeenCalledWith(PayoutOrderContext.MANUAL, [manualOrder]);
    });

    it('skips a context whose service is unhealthy', async () => {
      const orders = [createCustomPayoutOrder({ id: 1, context: PayoutOrderContext.BUY_CRYPTO })];
      jest.spyOn(bitcoinService, 'isHealthy').mockResolvedValue(false);
      const doPayoutForContextSpy = jest.spyOn(strategy, 'doPayoutForContextImpl');

      await strategy.doPayout(orders);

      expect(doPayoutForContextSpy).not.toHaveBeenCalled();
    });

    it('catches and logs errors without throwing', async () => {
      const orders = [createCustomPayoutOrder({ id: 1, context: PayoutOrderContext.BUY_CRYPTO })];
      jest.spyOn(bitcoinService, 'isHealthy').mockResolvedValue(true);
      strategy.doPayoutForContextImpl = () => Promise.reject(new Error('context boom'));
      const loggerErrorSpy = jest.spyOn((strategy as any).logger, 'error');

      await expect(strategy.doPayout(orders)).resolves.toBeUndefined();

      expect(loggerErrorSpy).toHaveBeenCalledWith('Error while executing Bitcoin payout orders:', expect.any(Error));
    });
  });

  describe('#checkPayoutCompletionData(...)', () => {
    let pricingService: PricingService;
    let convertFn: jest.Mock;

    beforeEach(() => {
      new ConfigService(); // sets the module-level Config (Config.defaultVolumeDecimal used by recordPayoutFee)
      pricingService = mock<PricingService>();
      Object.defineProperty(strategy, 'pricingService', { value: pricingService, configurable: true });
      convertFn = jest.fn().mockReturnValue(0.99);
      jest.spyOn(pricingService, 'getPrice').mockResolvedValue({ convert: convertFn } as any);
      repoSaveSpy.mockImplementation(async (o: PayoutOrder) => o as PayoutOrder);
    });

    it('completes each order, records the proportional payout fee and persists once when the tx is complete', async () => {
      const feeAsset = createCustomAsset({ name: 'BTC' });
      strategy.feeAssetValue = feeAsset;
      const order1 = createCustomPayoutOrder({
        id: 1,
        context: PayoutOrderContext.BUY_CRYPTO,
        status: PayoutOrderStatus.PAYOUT_PENDING,
        payoutTxId: 'BTC_TX',
        amount: 1,
      });
      const order2 = createCustomPayoutOrder({
        id: 2,
        context: PayoutOrderContext.BUY_CRYPTO,
        status: PayoutOrderStatus.PAYOUT_PENDING,
        payoutTxId: 'BTC_TX',
        amount: 3,
      });
      jest.spyOn(bitcoinService, 'isHealthy').mockResolvedValue(true);
      jest.spyOn(bitcoinService, 'getPayoutCompletionData').mockResolvedValue([true, 0.0008]);
      const complete1Spy = jest.spyOn(order1, 'complete');
      const recordFee1Spy = jest.spyOn(order1, 'recordPayoutFee');
      const recordFee2Spy = jest.spyOn(order2, 'recordPayoutFee');

      await strategy.checkPayoutCompletionData([order1, order2]);

      expect(bitcoinService.getPayoutCompletionData).toHaveBeenCalledWith(PayoutOrderContext.BUY_CRYPTO, 'BTC_TX');
      expect(pricingService.getPrice).toHaveBeenCalledWith(feeAsset, PriceCurrency.CHF, PriceValidity.ANY);
      expect(complete1Spy).toHaveBeenCalledTimes(1);
      // proportional fee: totalFee 0.0008 over total amount 4 -> 0.0002 (amount 1) and 0.0006 (amount 3)
      expect(convertFn).toHaveBeenCalledWith(0.0002, Config.defaultVolumeDecimal);
      expect(convertFn).toHaveBeenCalledWith(0.0006, Config.defaultVolumeDecimal);
      expect(recordFee1Spy).toHaveBeenCalledWith(feeAsset, 0.0002, 0.99);
      expect(recordFee2Spy).toHaveBeenCalledWith(feeAsset, 0.0006, 0.99);
      expect(order1.status).toBe(PayoutOrderStatus.COMPLETE);
      expect(order2.status).toBe(PayoutOrderStatus.COMPLETE);
      expect(repoSaveSpy).toHaveBeenCalledTimes(2);
      expect(repoSaveSpy).toHaveBeenCalledWith(order1);
      expect(repoSaveSpy).toHaveBeenCalledWith(order2);
    });

    it('leaves the order untouched when the tx is not yet complete', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'BTC_TX_PENDING' });
      jest.spyOn(bitcoinService, 'isHealthy').mockResolvedValue(true);
      jest.spyOn(bitcoinService, 'getPayoutCompletionData').mockResolvedValue([false, 0]);
      const completeSpy = jest.spyOn(order, 'complete');
      const recordFeeSpy = jest.spyOn(order, 'recordPayoutFee');

      await strategy.checkPayoutCompletionData([order]);

      expect(completeSpy).not.toHaveBeenCalled();
      expect(recordFeeSpy).not.toHaveBeenCalled();
      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
      expect(repoSaveSpy).not.toHaveBeenCalled();
    });

    it('skips a context whose service is unhealthy', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'BTC_TX_SKIP' });
      jest.spyOn(bitcoinService, 'isHealthy').mockResolvedValue(false);

      await strategy.checkPayoutCompletionData([order]);

      expect(bitcoinService.getPayoutCompletionData).not.toHaveBeenCalled();
      expect(repoSaveSpy).not.toHaveBeenCalled();
    });

    it('swallows a per-tx error from getPayoutCompletionData and continues without persisting', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'BTC_TX_ERR' });
      jest.spyOn(bitcoinService, 'isHealthy').mockResolvedValue(true);
      jest.spyOn(bitcoinService, 'getPayoutCompletionData').mockRejectedValue(new Error('rpc down'));
      const loggerErrorSpy = jest.spyOn((strategy as any).logger, 'error');

      await expect(strategy.checkPayoutCompletionData([order])).resolves.toBeUndefined();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error while checking payout completion data of payout orders'),
        expect.any(Error),
      );
      expect(repoSaveSpy).not.toHaveBeenCalled();
    });

    it('swallows an error thrown while health-checking and logs it', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'BTC_TX_HEALTH' });
      jest.spyOn(bitcoinService, 'isHealthy').mockRejectedValue(new Error('health boom'));
      const loggerErrorSpy = jest.spyOn((strategy as any).logger, 'error');

      await expect(strategy.checkPayoutCompletionData([order])).resolves.toBeUndefined();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Error while checking payout completion of Bitcoin payout orders:',
        expect.any(Error),
      );
      expect(repoSaveSpy).not.toHaveBeenCalled();
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

    it('falls back to "Unknown payout error" when the error has no message', async () => {
      const orders = [createCustomPayoutOrder({ id: 10 })];

      await strategy.trackPayoutFailureWrapper(orders, null as unknown as Error);

      expect(orders[0].retryCount).toBe(1);
      expect(orders[0].lastError).toBe('Unknown payout error');
      expect(repoSaveSpy).toBeCalledTimes(1);
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

  // Set per-test so #checkPayoutCompletionData(...) / #estimateFee(...) resolve a known fee asset.
  feeAssetValue: Asset = createDefaultAsset();

  get blockchain(): Blockchain {
    return Blockchain.BITCOIN;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  // Overridable per-test so #doPayout(...) tests can assert delegation / simulate a failing context
  // without a real chain client; spied on to capture (context, group) arguments.
  doPayoutForContextImpl: (context: PayoutOrderContext, group: PayoutOrder[]) => Promise<void> = () =>
    Promise.resolve();

  protected doPayoutForContext(context: PayoutOrderContext, group: PayoutOrder[]): Promise<void> {
    return this.doPayoutForContextImpl(context, group);
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

  // Overridable per-test; #estimateBlockchainFee(...) delegates to this via estimateFee(...).
  estimateFeeImpl: (asset: Asset) => Promise<FeeResult> = () =>
    Promise.resolve({ asset: this.feeAssetValue, amount: 0 });

  estimateFee(asset: Asset): Promise<FeeResult> {
    return this.estimateFeeImpl(asset);
  }

  protected getFeeAsset(): Promise<Asset> {
    return Promise.resolve(this.feeAssetValue);
  }
}
