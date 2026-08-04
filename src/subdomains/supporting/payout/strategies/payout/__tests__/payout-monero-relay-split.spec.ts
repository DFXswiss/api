/**
 * Unit tests for the Monero build/relay split (#4673).
 *
 * The wallet RPC's `transfer` builds, signs and relays atomically, and its -38
 * (WALLET_RPC_ERROR_CODE_NO_DAEMON_CONNECTION) is emitted unconditionally from every throw site — so
 * the API cannot tell a failed decoy fetch (nothing sent) from a failed relay (possibly sent) and has
 * to escalate every one of them to PayoutUncertain. MoneroStrategy therefore broadcasts in two phases:
 *
 *   1. build   — `transfer` with do_not_relay, which never reaches commit_tx and so reserves nothing;
 *   2. persist — the resulting tx id and relay metadata onto every designated order;
 *   3. relay   — `relay_tx`, which re-submits THAT transaction and can only ever yield THAT id.
 *
 * The properties pinned here are the ones that make the split safe:
 *   - a build-phase failure is plain and self-heals (no PayoutUncertain, no persisted id);
 *   - nothing is relayed until the persist has landed for the whole group;
 *   - a relay-phase failure leaves the order carrying its durable id, and every route back into the
 *     payout flow re-RELAYS the stored metadata — a -38 must never cause a REBUILD, because a rebuilt
 *     transaction would re-select the same unreserved inputs and race the first one;
 *   - PayoutUncertain survives as the backstop for what remains undecidable.
 */

import { mock } from 'jest-mock-extended';
import { Config, ConfigService } from 'src/config/config';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { createCustomPayoutOrder } from '../../../entities/__mocks__/payout-order.entity.mock';
import { PayoutOrder, PayoutOrderContext, PayoutOrderStatus } from '../../../entities/payout-order.entity';
import { PayoutBroadcastException } from '../../../exceptions/payout-broadcast.exception';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutMoneroService } from '../../../services/payout-monero.service';
import { MoneroStrategy } from '../impl/monero.strategy';

const CONTEXT = PayoutOrderContext.BUY_CRYPTO;
const XMR = createCustomAsset({ name: 'XMR', dexName: 'XMR' });

const SIGNED_TX_ID = 'SIGNED_XMR_TX';
const SIGNED_METADATA = 'DEADBEEF_METADATA';

// The wallet error at the centre of #4673: identical string and code whichever phase produced it.
const NO_DAEMON_CONNECTION = 'no connection to daemon';

describe('MoneroStrategy - build/relay split (#4673)', () => {
  let strategy: MoneroStrategyWrapper;

  let notificationService: NotificationService;
  let payoutMoneroService: PayoutMoneroService;
  let payoutOrderRepo: PayoutOrderRepository;
  let assetService: AssetService;

  let buildTransferSpy: jest.SpyInstance;
  let relayTransferSpy: jest.SpyInstance;
  let isTxKnownSpy: jest.SpyInstance;
  let repoUpdateSpy: jest.SpyInstance;

  beforeEach(() => {
    new ConfigService();
    Config.payout.maxPreBroadcastRetries = 3;

    notificationService = mock<NotificationService>();
    payoutMoneroService = mock<PayoutMoneroService>();
    payoutOrderRepo = mock<PayoutOrderRepository>();
    assetService = mock<AssetService>();

    buildTransferSpy = jest
      .spyOn(payoutMoneroService, 'buildTransfer')
      .mockResolvedValue({ txId: SIGNED_TX_ID, metadata: SIGNED_METADATA });
    relayTransferSpy = jest.spyOn(payoutMoneroService, 'relayTransfer').mockResolvedValue(SIGNED_TX_ID);
    isTxKnownSpy = jest.spyOn(payoutMoneroService, 'isTxKnown').mockResolvedValue(false);

    // The designation claim updates a single row; the signed-tx persist updates the whole group in one
    // statement and is the only caller passing an id ARRAY as criteria, which is what distinguishes them.
    repoUpdateSpy = jest
      .spyOn(payoutOrderRepo, 'update')
      .mockImplementation((criteria: any) =>
        Promise.resolve({ affected: Array.isArray(criteria) ? criteria.length : 1 } as any),
      );
    jest.spyOn(payoutOrderRepo, 'save').mockImplementation((o: any) => Promise.resolve(o));

    strategy = new MoneroStrategyWrapper(notificationService, payoutMoneroService, payoutOrderRepo, assetService);
  });

  function confirmedOrder(customValues: Partial<PayoutOrder> = {}): PayoutOrder {
    return createCustomPayoutOrder({
      id: 114462,
      asset: XMR,
      amount: 0.45709632,
      destinationAddress: 'XMR_DEST_01',
      status: PayoutOrderStatus.PREPARATION_CONFIRMED,
      payoutTxId: null,
      retryCount: 0,
      ...customValues,
    });
  }

  // The signed-tx persist is the only update whose criteria is a list of ids.
  function signedTxPersists(): any[][] {
    return repoUpdateSpy.mock.calls.filter(([criteria]) => Array.isArray(criteria));
  }

  describe('build phase', () => {
    it('builds, persists the signed tx on every order, and only then relays', async () => {
      const orders = [
        confirmedOrder({ id: 1, destinationAddress: 'XMR_DEST_01', amount: 1 }),
        confirmedOrder({ id: 2, destinationAddress: 'XMR_DEST_02', amount: 2 }),
      ];

      await strategy.sendWrapper(CONTEXT, orders);

      const [persist] = signedTxPersists();
      expect(persist[0]).toEqual([1, 2]);
      expect(persist[1]).toEqual({ signedPayoutTxId: SIGNED_TX_ID, signedPayoutTxMetadata: SIGNED_METADATA });

      // Ordering is the guarantee, not an implementation detail: a relay that overtakes its persist is
      // exactly the state the split exists to prevent.
      expect(buildTransferSpy.mock.invocationCallOrder[0]).toBeLessThan(repoUpdateSpy.mock.invocationCallOrder[2]);
      expect(repoUpdateSpy.mock.invocationCallOrder[2]).toBeLessThan(relayTransferSpy.mock.invocationCallOrder[0]);

      expect(relayTransferSpy).toHaveBeenCalledWith(SIGNED_METADATA);
      for (const order of orders) {
        expect(order.signedPayoutTxId).toBe(SIGNED_TX_ID);
        expect(order.signedPayoutTxMetadata).toBe(SIGNED_METADATA);
        expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
        expect(order.payoutTxId).toBe(SIGNED_TX_ID);
      }
    });

    // The headline case: 12 of 13 production payout failures over 30 days were get_outs.bin, i.e. the
    // build phase. do_not_relay means those reserve nothing, so they are ordinary retryable errors now.
    it('rolls a build-phase -38 back for auto-retry instead of escalating', async () => {
      const order = confirmedOrder();
      buildTransferSpy.mockRejectedValueOnce(new Error(NO_DAEMON_CONNECTION));

      await strategy.sendWrapper(CONTEXT, [order]);

      expect(order.status).toBe(PayoutOrderStatus.PREPARATION_CONFIRMED);
      expect(order.retryCount).toBe(1);
      expect(order.lastError).toBe(NO_DAEMON_CONNECTION);
      // Nothing was signed, so nothing may be recorded — and nothing was submitted.
      expect(order.signedPayoutTxId).toBeUndefined();
      expect(signedTxPersists()).toHaveLength(0);
      expect(relayTransferSpy).not.toHaveBeenCalled();
      // PAYOUT_DESIGNATED is what processFailedOrders escalates to PayoutUncertain; the rollback is
      // precisely what keeps this order out of that queue.
      expect(order.status).not.toBe(PayoutOrderStatus.PAYOUT_DESIGNATED);
    });
  });

  describe('persist phase', () => {
    it('does not relay when the persist fails', async () => {
      const order = confirmedOrder();
      repoUpdateSpy.mockImplementation((criteria: any) =>
        Array.isArray(criteria) ? Promise.reject(new Error('DB write failed')) : Promise.resolve({ affected: 1 }),
      );

      await strategy.sendWrapper(CONTEXT, [order]);

      expect(relayTransferSpy).not.toHaveBeenCalled();
      expect(order.status).toBe(PayoutOrderStatus.PREPARATION_CONFIRMED);
      expect(order.retryCount).toBe(1);
    });

    // A partial write would leave an order the transaction pays with no record of it — and that order
    // would later be rebuilt into a SECOND payment to the same address.
    it('does not relay when the persist covers only part of the group', async () => {
      const orders = [confirmedOrder({ id: 1 }), confirmedOrder({ id: 2, destinationAddress: 'XMR_DEST_02' })];
      // Both claims and the group persist report a single affected row: two orders, one written.
      repoUpdateSpy.mockResolvedValue({ affected: 1 } as any);

      await strategy.sendWrapper(CONTEXT, orders);

      expect(relayTransferSpy).not.toHaveBeenCalled();
      expect(orders[0].lastError).toContain('persisted for 1 of 2 order(s), not relaying');
      expect(orders.map((o) => o.status)).toEqual([
        PayoutOrderStatus.PREPARATION_CONFIRMED,
        PayoutOrderStatus.PREPARATION_CONFIRMED,
      ]);
    });
  });

  describe('relay phase', () => {
    it('keeps the durable tx id on the order and rolls back for a re-relay when the relay -38s', async () => {
      const order = confirmedOrder();
      relayTransferSpy.mockRejectedValueOnce(new PayoutBroadcastException(NO_DAEMON_CONNECTION));

      await strategy.sendWrapper(CONTEXT, [order]);

      // The id is what turns the operator's wallet-log forensics into a lookup.
      expect(order.signedPayoutTxId).toBe(SIGNED_TX_ID);
      expect(order.signedPayoutTxMetadata).toBe(SIGNED_METADATA);
      expect(order.payoutTxId).toBeNull();
      expect(order.status).toBe(PayoutOrderStatus.PREPARATION_CONFIRMED);
      expect(order.lastError).toContain(SIGNED_TX_ID);
    });

    // The downgrade to a retryable error is licensed by the persisted metadata alone: without it the
    // retry would be a rebuild, and then failing closed is the only correct outcome.
    it('stays fail-closed on a relay failure when the order carries no persisted metadata', async () => {
      const order = confirmedOrder();
      // Persist reports success but writes nothing back onto the entity (stale row, wrong id, ...).
      jest.spyOn(order, 'recordSignedPayoutTx').mockReturnValue(order);
      relayTransferSpy.mockRejectedValueOnce(new PayoutBroadcastException(NO_DAEMON_CONNECTION));

      // `send` re-throws a PayoutBroadcastException rather than rolling back — that is the fail-closed
      // path, and the order is left designated for processFailedOrders to park as PayoutUncertain.
      await expect(strategy.sendWrapper(CONTEXT, [order])).rejects.toBeInstanceOf(PayoutBroadcastException);

      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_DESIGNATED);
    });

    it('escalates once the pre-broadcast retry budget is spent, so PayoutUncertain stays the backstop', async () => {
      const order = confirmedOrder({ retryCount: Config.payout.maxPreBroadcastRetries });
      relayTransferSpy.mockRejectedValueOnce(new PayoutBroadcastException(NO_DAEMON_CONNECTION));

      await strategy.sendWrapper(CONTEXT, [order]);

      // Left designated -> processFailedOrders parks it as PayoutUncertain, now with a durable tx id.
      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_DESIGNATED);
      expect(order.signedPayoutTxId).toBe(SIGNED_TX_ID);
    });
  });

  describe('resume of a signed transaction', () => {
    function signedOrder(customValues: Partial<PayoutOrder> = {}): PayoutOrder {
      return confirmedOrder({
        signedPayoutTxId: SIGNED_TX_ID,
        signedPayoutTxMetadata: SIGNED_METADATA,
        ...customValues,
      });
    }

    it('resolves by lookup when the earlier relay reached the daemon after all', async () => {
      const order = signedOrder();
      isTxKnownSpy.mockResolvedValue(true);

      await strategy.sendWrapper(CONTEXT, [order]);

      expect(isTxKnownSpy).toHaveBeenCalledWith(SIGNED_TX_ID);
      expect(relayTransferSpy).not.toHaveBeenCalled();
      expect(buildTransferSpy).not.toHaveBeenCalled();
      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
      expect(order.payoutTxId).toBe(SIGNED_TX_ID);
    });

    // The regression guard the whole change hangs on: a -38 may never lead to a rebuild. relay_tx
    // re-submits the same pending_tx under the same id; `transfer` would sign a competing one over the
    // same still-unreserved inputs.
    it('re-relays the stored metadata and never rebuilds when the tx is nowhere to be found', async () => {
      const order = signedOrder();
      isTxKnownSpy.mockResolvedValue(false);

      await strategy.sendWrapper(CONTEXT, [order]);

      expect(relayTransferSpy).toHaveBeenCalledWith(SIGNED_METADATA);
      expect(buildTransferSpy).not.toHaveBeenCalled();
      expect(signedTxPersists()).toHaveLength(0);
      expect(order.payoutTxId).toBe(SIGNED_TX_ID);
    });

    it('re-relays rather than rebuilds when the lookup itself fails', async () => {
      const order = signedOrder();
      isTxKnownSpy.mockRejectedValue(new Error(NO_DAEMON_CONNECTION));

      await strategy.sendWrapper(CONTEXT, [order]);

      expect(relayTransferSpy).toHaveBeenCalledWith(SIGNED_METADATA);
      expect(buildTransferSpy).not.toHaveBeenCalled();
    });

    // An id without metadata cannot be relayed. Resuming it would fall through to a rebuild of a
    // transaction whose id is already recorded, so the group is rebuilt explicitly and re-persisted.
    it('rebuilds when the id was recorded without metadata', async () => {
      const order = signedOrder({ signedPayoutTxMetadata: null });

      await strategy.sendWrapper(CONTEXT, [order]);

      expect(isTxKnownSpy).not.toHaveBeenCalled();
      expect(buildTransferSpy).toHaveBeenCalledTimes(1);
      expect(signedTxPersists()).toHaveLength(1);
    });
  });

  describe('doPayoutForContext(...)', () => {
    it('resumes signed orders as whole groups and builds only for the rest', async () => {
      const signedA = confirmedOrder({
        id: 1,
        signedPayoutTxId: 'TX_A',
        signedPayoutTxMetadata: 'META_A',
        destinationAddress: 'DEST_A1',
      });
      const signedA2 = confirmedOrder({
        id: 2,
        signedPayoutTxId: 'TX_A',
        signedPayoutTxMetadata: 'META_A',
        destinationAddress: 'DEST_A2',
      });
      const signedB = confirmedOrder({
        id: 3,
        signedPayoutTxId: 'TX_B',
        signedPayoutTxMetadata: 'META_B',
        destinationAddress: 'DEST_B',
      });
      const fresh = confirmedOrder({ id: 4, destinationAddress: 'DEST_FRESH' });
      jest.spyOn(payoutMoneroService, 'getUnlockedBalance').mockResolvedValue(100);
      const sendSpy = jest.spyOn(strategy as any, 'send').mockResolvedValue(undefined);

      await strategy.doPayoutForContextWrapper(CONTEXT, [signedA, signedB, signedA2, fresh]);

      // One send per signed transaction — the orders a transaction pays must not be split across
      // rounds, or one subset would relay a transaction the other no longer tracks.
      expect(sendSpy.mock.calls.map(([, group]) => (group as PayoutOrder[]).map((o) => o.id))).toEqual([
        [1, 2],
        [3],
        [4],
      ]);
    });

    it('keeps paying the unsigned orders when resuming a signed group throws', async () => {
      const signed = confirmedOrder({ id: 1, signedPayoutTxId: 'TX_A', signedPayoutTxMetadata: 'META_A' });
      const fresh = confirmedOrder({ id: 2, destinationAddress: 'DEST_FRESH' });
      jest.spyOn(payoutMoneroService, 'getUnlockedBalance').mockResolvedValue(100);
      const sendSpy = jest
        .spyOn(strategy as any, 'send')
        .mockRejectedValueOnce(new Error('relay failed'))
        .mockResolvedValue(undefined);

      await expect(strategy.doPayoutForContextWrapper(CONTEXT, [signed, fresh])).resolves.toBeUndefined();

      expect(sendSpy).toHaveBeenCalledTimes(2);
      expect((sendSpy.mock.calls[1][1] as PayoutOrder[]).map((o) => o.id)).toEqual([2]);
    });
  });

  it('refuses the atomic dispatch path outright', () => {
    expect(() => strategy.dispatchPayoutWrapper()).toThrow('Monero payouts are broadcast via broadcastPayout');
  });
});

class MoneroStrategyWrapper extends MoneroStrategy {
  sendWrapper(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    return this.send(context, orders);
  }

  doPayoutForContextWrapper(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    return this.doPayoutForContext(context, orders);
  }

  dispatchPayoutWrapper(): Promise<string> {
    return this.dispatchPayout();
  }
}
