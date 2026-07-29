import { createMock } from '@golevelup/ts-jest';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import {
  ScryptBalanceTransaction,
  ScryptOrderInfo,
  ScryptOrderStatus,
  ScryptTransactionStatus,
  ScryptWithdrawStatus,
} from 'src/integration/exchange/dto/scrypt.dto';
import {
  ScryptAmendRejectedError,
  ScryptOrderNotFoundError,
  ScryptRequestTimeoutError,
  ScryptUnconfirmedWriteError,
  ScryptVenueRejectionError,
} from 'src/integration/exchange/services/scrypt-websocket-connection';
import { ScryptService } from 'src/integration/exchange/services/scrypt.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Util } from 'src/shared/utils/util';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { LiquidityManagementAction } from '../../../entities/liquidity-management-action.entity';
import { LiquidityManagementOrder } from '../../../entities/liquidity-management-order.entity';
import { UncertainOrderResolution } from '../../../enums';
import { OrderFailedException } from '../../../exceptions/order-failed.exception';
import { OrderOutcomeUnknownException } from '../../../exceptions/order-outcome-unknown.exception';
import { LiquidityManagementOrderRepository } from '../../../repositories/liquidity-management-order.repository';
import { ScryptAdapter, ScryptAdapterCommands } from '../scrypt.adapter';

const DEST_ENV = 'TEST_SCRYPT_WITHDRAW_ADDR';

function createWithdrawOrder(overrides: Partial<LiquidityManagementOrder> = {}): LiquidityManagementOrder {
  return Object.assign(new LiquidityManagementOrder(), {
    correlationId: 'corr-1',
    // young enough that an unobservable withdrawal is still waited on rather than quarantined
    created: new Date(),
    action: {
      command: ScryptAdapterCommands.WITHDRAW,
      paramMap: {
        destinationAddress: DEST_ENV,
        destinationBlockchain: Blockchain.ETHEREUM,
      },
    },
    outputAmount: undefined,
    ...overrides,
  });
}

function createUncertainSellOrder(overrides: Partial<LiquidityManagementOrder> = {}): LiquidityManagementOrder {
  return Object.assign(new LiquidityManagementOrder(), {
    id: 4711,
    correlationId: 'dfx-lm-4711',
    // young enough that an unreadable order is still retried rather than quarantined
    created: new Date(),
    updated: new Date(Date.now() - 30 * 60 * 1000),
    action: { command: ScryptAdapterCommands.SELL, paramMap: {} },
    ...overrides,
  });
}

/** Minimal but fully typed venue order record, so the tests do not have to widen the return type. */
function venueOrder(id: string, status = ScryptOrderStatus.NEW): ScryptOrderInfo {
  return { id, symbol: 'EUR/USDT', side: 'Sell', status, quantity: 1, filledQuantity: 0, remainingQuantity: 1 };
}

/** Typed action stub — `paramMap` is a getter over `params`, so the raw field is what a fixture sets. */
function withdrawAction(): LiquidityManagementAction {
  return Object.assign(new LiquidityManagementAction(), { command: ScryptAdapterCommands.WITHDRAW, params: '{}' });
}

describe('ScryptAdapter', () => {
  let adapter: ScryptAdapter;
  let scryptService: ScryptService;
  let dexService: DexService;
  let orderRepo: LiquidityManagementOrderRepository;
  let pricingService: PricingService;
  let assetService: AssetService;

  beforeEach(() => {
    process.env[DEST_ENV] = '0xabc';

    scryptService = createMock<ScryptService>({ name: 'Scrypt' });
    dexService = createMock<DexService>();
    orderRepo = createMock<LiquidityManagementOrderRepository>();
    pricingService = createMock<PricingService>();
    assetService = createMock<AssetService>();

    adapter = new ScryptAdapter(scryptService, dexService, orderRepo, pricingService, assetService);
  });

  afterEach(() => {
    delete process.env[DEST_ENV];
    jest.restoreAllMocks();
  });

  describe('checkWithdrawCompletion', () => {
    it('throws OrderFailedException when status is REJECTED with no txHash', async () => {
      const withdrawal: ScryptWithdrawStatus = {
        id: 'w-1',
        status: ScryptTransactionStatus.REJECTED,
        rejectReason: 'InvalidAddress',
        rejectText: 'bad address',
      };
      jest.spyOn(scryptService, 'getWithdrawalStatus').mockResolvedValue(withdrawal);

      await expect(adapter.checkCompletion(createWithdrawOrder())).rejects.toThrow(OrderFailedException);
      await expect(adapter.checkCompletion(createWithdrawOrder())).rejects.toThrow(
        /Withdrawal corr-1 has failed with status Rejected/,
      );
      expect(dexService.checkTransferCompletion).not.toHaveBeenCalled();
    });

    it('throws OrderFailedException when status is FAILED', async () => {
      const withdrawal: ScryptWithdrawStatus = {
        id: 'w-2',
        status: ScryptTransactionStatus.FAILED,
        txHash: '0xdead',
        rejectReason: 'NetworkError',
        rejectText: 'timeout',
      };
      jest.spyOn(scryptService, 'getWithdrawalStatus').mockResolvedValue(withdrawal);

      await expect(adapter.checkCompletion(createWithdrawOrder())).rejects.toThrow(OrderFailedException);
      expect(dexService.checkTransferCompletion).not.toHaveBeenCalled();
    });

    it('throws OrderFailedException when status is FAILED with no txHash', async () => {
      const withdrawal: ScryptWithdrawStatus = {
        id: 'w-3',
        status: ScryptTransactionStatus.FAILED,
        rejectReason: 'NetworkError',
        rejectText: 'timeout',
      };
      jest.spyOn(scryptService, 'getWithdrawalStatus').mockResolvedValue(withdrawal);

      await expect(adapter.checkCompletion(createWithdrawOrder())).rejects.toThrow(OrderFailedException);
      expect(dexService.checkTransferCompletion).not.toHaveBeenCalled();
    });

    it('returns false when withdrawal is missing or still pending without a txHash', async () => {
      jest.spyOn(scryptService, 'getWithdrawalStatus').mockResolvedValueOnce(null);

      await expect(adapter.checkCompletion(createWithdrawOrder())).resolves.toBe(false);

      jest.spyOn(scryptService, 'getWithdrawalStatus').mockResolvedValueOnce({
        id: 'w-pending',
        status: ScryptTransactionStatus.COMPLETED,
        // no txHash yet
      });

      await expect(adapter.checkCompletion(createWithdrawOrder())).resolves.toBe(false);
      expect(dexService.checkTransferCompletion).not.toHaveBeenCalled();
    });

    it('sets order.outputAmount and delegates to dexService when withdrawal has a txHash', async () => {
      const withdrawal: ScryptWithdrawStatus = {
        id: 'w-ok',
        status: ScryptTransactionStatus.COMPLETED,
        txHash: '0xsuccess',
        amount: 3.25,
      };
      jest.spyOn(scryptService, 'getWithdrawalStatus').mockResolvedValue(withdrawal);
      jest.spyOn(dexService, 'checkTransferCompletion').mockResolvedValue(true);

      const order = createWithdrawOrder();
      const result = await adapter.checkCompletion(order);

      expect(result).toBe(true);
      expect(order.outputAmount).toBe(3.25);
      expect(dexService.checkTransferCompletion).toHaveBeenCalledWith('0xsuccess', Blockchain.ETHEREUM);
    });
  });

  describe('checkWithdrawCompletion — unobservable withdrawals', () => {
    it('quarantines an aged withdrawal the venue has no record of at all', async () => {
      jest.spyOn(scryptService, 'getWithdrawalStatus').mockResolvedValue(null);
      const old = createWithdrawOrder({ created: new Date(Date.now() - 120 * 60 * 1000) });

      await expect(adapter.checkCompletion(old)).rejects.toBeInstanceOf(OrderOutcomeUnknownException);
    });

    it('keeps waiting on an aged withdrawal the venue DOES know but has not settled', async () => {
      // a record without a hash is an observation, not an unknown outcome — quarantining it would only
      // bounce the order between reconciliation and the completion check
      jest.spyOn(scryptService, 'getWithdrawalStatus').mockResolvedValue({
        id: 'w-inflight',
        status: ScryptTransactionStatus.COMPLETED,
      });
      const old = createWithdrawOrder({ created: new Date(Date.now() - 120 * 60 * 1000) });

      await expect(adapter.checkCompletion(old)).resolves.toBe(false);
    });

    it('still just waits while the withdrawal is young', async () => {
      jest.spyOn(scryptService, 'getWithdrawalStatus').mockResolvedValue(null);

      await expect(adapter.checkCompletion(createWithdrawOrder({ created: new Date() }))).resolves.toBe(false);
    });
  });

  describe('reserveCorrelationId', () => {
    it('derives a reproducible reference from the order id', () => {
      const order = Object.assign(new LiquidityManagementOrder(), { id: 4711 });

      const reference = adapter.reserveCorrelationId(order);

      expect(reference).toBe('dfx-lm-4711');
      // the venue requires uniqueness per day and fewer than 36 characters
      expect(reference.length).toBeLessThan(36);
    });
  });

  describe('classifySendOutcome', () => {
    it('turns a timeout into an unknown outcome, so the order is never silently repeated', () => {
      const timeout = new ScryptRequestTimeoutError('Timeout waiting for ExecutionReport update after 60000ms');

      const classified = adapter['classifySendOutcome'](timeout, 'sell of 1 EUR to USDT');

      expect(classified).toBeInstanceOf(OrderOutcomeUnknownException);
    });

    it('also treats a dropped connection as unknown — the bytes may already have reached the venue', () => {
      // requestWithId hands the payload to the socket before the pending entry exists; a later close rejects
      // it with a generic message that says nothing about whether the venue acted on it.
      const dropped = new Error('Connection closed');

      const classified = adapter['classifySendOutcome'](dropped, 'withdrawal of 1 USDT to 0xabc');

      expect(classified).toBeInstanceOf(OrderOutcomeUnknownException);
    });

    it('keeps a venue rejection an ordinary failure — the venue replied, so the outcome is known', () => {
      const rejected = new ScryptVenueRejectionError('Scrypt withdrawal rejected: insufficient limit');

      const classified = adapter['classifySendOutcome'](rejected, 'withdrawal of 1 USDT to 0xabc');

      expect(classified).toBe(rejected);
      expect(classified).not.toBeInstanceOf(OrderOutcomeUnknownException);
    });
  });

  describe('checkTradeCompletion — recovering a lost adoption', () => {
    it('adopts a claimed replacement the venue is working before it may write again', async () => {
      // the window: the venue accepted the replacement, the save that would have recorded it failed, and the
      // row still names the predecessor the venue has since cancelled
      jest
        .spyOn(scryptService, 'getOrderStatus')
        .mockImplementation(async (id: string) => (id === 'dfx-lm-4711-1' ? venueOrder(id) : null));
      jest.spyOn(scryptService, 'checkTrade').mockResolvedValue(false);
      const order = createUncertainSellOrder();
      order.recordSpentCorrelationId('dfx-lm-4711-1');

      await adapter['checkTradeCompletion'](order, 'EUR', 'USDT');

      expect(order.correlationId).toBe('dfx-lm-4711-1');
      expect(orderRepo.save).toHaveBeenCalled();
    });

    it('does not adopt a replacement the venue rejected', async () => {
      jest
        .spyOn(scryptService, 'getOrderStatus')
        .mockImplementation(async (id: string) => venueOrder(id, ScryptOrderStatus.REJECTED));
      jest.spyOn(scryptService, 'checkTrade').mockResolvedValue(false);
      const order = createUncertainSellOrder();
      order.recordSpentCorrelationId('dfx-lm-4711-1');

      await adapter['checkTradeCompletion'](order, 'EUR', 'USDT');

      expect(order.correlationId).toBe('dfx-lm-4711');
    });

    it('never walks back: after an amend this row recorded, the cancelled original is left alone', async () => {
      // a predecessor is not a replacement. Adopting it would restart the very quantity the replacement the
      // row already names is working, which is the double execution this whole path exists to prevent.
      const getOrderStatus = jest
        .spyOn(scryptService, 'getOrderStatus')
        .mockImplementation(async (id: string) =>
          venueOrder(id, id === 'dfx-lm-4711' ? ScryptOrderStatus.CANCELED : ScryptOrderStatus.NEW),
        );
      jest.spyOn(scryptService, 'checkTrade').mockResolvedValue(false);
      const order = createUncertainSellOrder();
      order.recordSpentCorrelationId('dfx-lm-4711-1');
      order.updateCorrelationId('dfx-lm-4711-1');

      await adapter['checkTradeCompletion'](order, 'EUR', 'USDT');

      expect(order.correlationId).toBe('dfx-lm-4711-1');
      expect(getOrderStatus).not.toHaveBeenCalledWith('dfx-lm-4711');
    });

    it('writes nothing while a claimed replacement is absent, even with a cancelled predecessor in view', async () => {
      // the reference is claimed BEFORE the request leaves, so one the venue does not show may be live there
      // this second — and the cancelled predecessor is exactly the bait for sending a second one next to it
      jest
        .spyOn(scryptService, 'getOrderStatus')
        .mockImplementation(async (id: string) =>
          id === 'dfx-lm-4711' ? venueOrder(id, ScryptOrderStatus.CANCELED) : null,
        );
      const checkTrade = jest.spyOn(scryptService, 'checkTrade').mockResolvedValue(false);
      const order = createUncertainSellOrder();
      order.recordSpentCorrelationId('dfx-lm-4711-1');

      await expect(adapter['checkTradeCompletion'](order, 'EUR', 'USDT')).resolves.toBe(false);

      expect(checkTrade).not.toHaveBeenCalled();
      expect(order.correlationId).toBe('dfx-lm-4711');
    });

    it('writes nothing when the venue cannot be asked about a claimed replacement at all', async () => {
      // an unreadable lookup is not a reply either, and only a reply can rule a claimed reference out
      jest.spyOn(scryptService, 'getOrderStatus').mockRejectedValue(new Error('connection closed'));
      const checkTrade = jest.spyOn(scryptService, 'checkTrade').mockResolvedValue(false);
      const order = createUncertainSellOrder();
      order.recordSpentCorrelationId('dfx-lm-4711-1');

      await expect(adapter['checkTradeCompletion'](order, 'EUR', 'USDT')).resolves.toBe(false);

      expect(checkTrade).not.toHaveBeenCalled();
    });

    it('quarantines an aged order whose claimed replacement nobody can account for', async () => {
      // holding writes back is safe, but not for good — the manual path only accepts quarantined orders,
      // so without this an order nobody can observe would have no way out at all
      jest.spyOn(scryptService, 'getOrderStatus').mockResolvedValue(null);
      // a check that would otherwise report cleanly, so the quarantine can only come from the barrier itself
      const checkTrade = jest.spyOn(scryptService, 'checkTrade').mockResolvedValue(false);
      const old = createUncertainSellOrder({ created: new Date(Date.now() - 120 * 60 * 1000) });
      old.recordSpentCorrelationId('dfx-lm-4711-1');

      await expect(adapter['checkTradeCompletion'](old, 'EUR', 'USDT')).rejects.toThrow(OrderOutcomeUnknownException);

      expect(checkTrade).not.toHaveBeenCalled();
    });

    it('does not quarantine an aged order the venue can still show us, whatever failed downstream', async () => {
      // otherwise reconciliation hands it straight back and the next check quarantines it again
      jest.spyOn(scryptService, 'getOrderStatus').mockImplementation(async (id: string) => venueOrder(id));
      jest.spyOn(scryptService, 'checkTrade').mockRejectedValue(new Error('pricing service unavailable'));
      const old = createUncertainSellOrder({ created: new Date(Date.now() - 120 * 60 * 1000) });

      await expect(adapter['checkTradeCompletion'](old, 'EUR', 'USDT')).resolves.toBe(false);
    });
  });

  describe('checkTradeCompletion — the amend boundary', () => {
    it('quarantines when an amend or restart went unconfirmed, instead of failing the order', async () => {
      // The check can WRITE (cancel-replace, restart). An unconfirmed write there may have created a live
      // order at the venue; failing would pause the rule, which auto-reactivates and reissues the trade.
      jest
        .spyOn(scryptService, 'checkTrade')
        .mockRejectedValue(new ScryptUnconfirmedWriteError('no confirmed outcome for the amend', 'dfx-lm-4711-1'));

      await expect(adapter['checkTradeCompletion'](createUncertainSellOrder(), 'EUR', 'USDT')).rejects.toBeInstanceOf(
        OrderOutcomeUnknownException,
      );
    });

    it('carries the replacement reference into the quarantine reason, so it can be reconciled', async () => {
      jest
        .spyOn(scryptService, 'checkTrade')
        .mockRejectedValue(new ScryptUnconfirmedWriteError('no confirmed outcome for the amend', 'dfx-lm-4711-1'));

      await expect(adapter['checkTradeCompletion'](createUncertainSellOrder(), 'EUR', 'USDT')).rejects.toThrow(
        /dfx-lm-4711-1/,
      );
    });

    it('still treats a plain dropped connection on the read path as retry-next-tick', async () => {
      jest.spyOn(scryptService, 'checkTrade').mockRejectedValue(new Error('Connection closed'));

      await expect(adapter['checkTradeCompletion'](createUncertainSellOrder(), 'EUR', 'USDT')).resolves.toBe(false);
    });

    it('does not fail an acknowledged order just because it could not be read', async () => {
      // Failing here would release the rule to open a second position while the first is live at the venue.
      jest.spyOn(scryptService, 'checkTrade').mockRejectedValue(new Error('malformed market data snapshot'));

      await expect(adapter['checkTradeCompletion'](createUncertainSellOrder(), 'EUR', 'USDT')).resolves.toBe(false);
    });

    it('also stops retrying when the error is a transient transport one', async () => {
      jest.spyOn(scryptService, 'checkTrade').mockRejectedValue(new Error('Connection closed'));
      jest.spyOn(scryptService, 'getOrderStatus').mockResolvedValue(null);
      const old = createUncertainSellOrder({ created: new Date(Date.now() - 120 * 60 * 1000) });

      await expect(adapter['checkTradeCompletion'](old, 'EUR', 'USDT')).rejects.toBeInstanceOf(
        OrderOutcomeUnknownException,
      );
    });

    it('stops retrying an order it has been unable to observe for too long, and quarantines it', async () => {
      // otherwise it polls for good: the manual path only accepts quarantined orders, so there would be no
      // way out at all
      jest.spyOn(scryptService, 'checkTrade').mockRejectedValue(new Error('malformed market data snapshot'));
      // and the venue cannot show us the order either — that is what makes it a blind spot rather than a
      // downstream hiccup
      jest.spyOn(scryptService, 'getOrderStatus').mockResolvedValue(null);
      const old = createUncertainSellOrder({ created: new Date(Date.now() - 120 * 60 * 1000) });

      await expect(adapter['checkTradeCompletion'](old, 'EUR', 'USDT')).rejects.toBeInstanceOf(
        OrderOutcomeUnknownException,
      );
    });

    it('quarantines an order the venue acknowledged and can no longer find', async () => {
      jest
        .spyOn(scryptService, 'checkTrade')
        .mockRejectedValue(new ScryptOrderNotFoundError('Order dfx-lm-4711 not found after 90 minutes'));

      await expect(adapter['checkTradeCompletion'](createUncertainSellOrder(), 'EUR', 'USDT')).rejects.toBeInstanceOf(
        OrderOutcomeUnknownException,
      );
    });

    it('keeps watching the original when the venue refuses an amend, and notes the spent reference', async () => {
      jest
        .spyOn(scryptService, 'checkTrade')
        .mockRejectedValue(new ScryptAmendRejectedError('Scrypt refused the amend', 'dfx-lm-4711-1'));
      const order = createUncertainSellOrder();

      await expect(adapter['checkTradeCompletion'](order, 'EUR', 'USDT')).resolves.toBe(false);
      // recorded, so the next derivation moves on instead of reusing a reference the venue already burnt
      expect(adapter['nextCorrelationId'](order)).toBe('dfx-lm-4711-2');
    });

    it('does not accept a mere message resembling a rejection as a verdict', async () => {
      // the whole point of the type: a transport error quoting the phrase must not end the order
      jest.spyOn(scryptService, 'checkTrade').mockRejectedValue(new Error('Scrypt order rejected: bad price'));

      await expect(adapter['checkTradeCompletion'](createUncertainSellOrder(), 'EUR', 'USDT')).resolves.toBe(false);
    });

    it('quarantines a read timeout rather than failing — every write here is already wrapped', async () => {
      jest.spyOn(scryptService, 'checkTrade').mockRejectedValue(new ScryptRequestTimeoutError('Request timeout'));

      await expect(adapter['checkTradeCompletion'](createUncertainSellOrder(), 'EUR', 'USDT')).resolves.toBe(false);
    });

    it('fails the order when the venue explicitly rejected it — that is a verdict, not silence', async () => {
      jest
        .spyOn(scryptService, 'checkTrade')
        .mockRejectedValue(new ScryptVenueRejectionError('Scrypt order rejected: bad price'));

      await expect(adapter['checkTradeCompletion'](createUncertainSellOrder(), 'EUR', 'USDT')).rejects.toBeInstanceOf(
        OrderFailedException,
      );
    });
  });

  describe('nextCorrelationId', () => {
    it('names the replacement an amend or restart would create, reproducibly from the row', () => {
      const order = Object.assign(new LiquidityManagementOrder(), { id: 4711, correlationId: 'dfx-lm-4711' });

      expect(adapter['nextCorrelationId'](order)).toBe('dfx-lm-4711-1');

      order.updateCorrelationId('dfx-lm-4711-1');
      expect(adapter['nextCorrelationId'](order)).toBe('dfx-lm-4711-2');
    });
  });

  describe('resolveUncertainOrder', () => {
    it('reports SENT when the venue knows the reference', async () => {
      jest.spyOn(scryptService, 'getOrderStatus').mockResolvedValue(venueOrder('dfx-lm-4711'));

      await expect(adapter.resolveUncertainOrder(createUncertainSellOrder())).resolves.toBe(
        UncertainOrderResolution.SENT,
      );
    });

    it('never concludes NOT_SENT from mere absence, however old the order is', async () => {
      // Scrypt offers no terminal "this reference was never accepted" reply, so absence from a snapshot is
      // not evidence. Releasing the rule on that basis is what would let a late-materialising request repeat.
      jest.spyOn(scryptService, 'getOrderStatus').mockResolvedValue(null);
      const ancient = createUncertainSellOrder({ updated: new Date(Date.now() - 24 * 60 * 60 * 1000) });

      await expect(adapter.resolveUncertainOrder(ancient)).resolves.toBe(UncertainOrderResolution.UNRESOLVED);
    });

    it.each([undefined, null])(
      'reports UNAVAILABLE when the reference is %p — there was nothing to ask about',
      async (correlationId) => {
        // UNRESOLVED would say the venue answered and had no record, and the caller may abandon an order on
        // that once its bound expires. With no reference the venue was never asked at all, so the order has
        // to keep waiting for a person rather than be failed on a lookup that never ran.
        const getOrderStatus = jest.spyOn(scryptService, 'getOrderStatus');
        const order = createUncertainSellOrder({ correlationId, previousCorrelationIds: null });

        await expect(adapter.resolveUncertainOrder(order)).resolves.toBe(UncertainOrderResolution.UNAVAILABLE);
        expect(getOrderStatus).not.toHaveBeenCalled();
      },
    );

    it('reports UNAVAILABLE when the lookup itself fails — no question reached the venue', async () => {
      jest.spyOn(scryptService, 'getOrderStatus').mockRejectedValue(new Error('Connection closed'));

      await expect(adapter.resolveUncertainOrder(createUncertainSellOrder())).resolves.toBe(
        UncertainOrderResolution.UNAVAILABLE,
      );
    });

    it('uses the withdrawal lookup for withdraw orders', async () => {
      jest.spyOn(scryptService, 'findWithdrawal').mockResolvedValue(null);
      const order = createUncertainSellOrder({
        action: withdrawAction(),
      });

      await expect(adapter.resolveUncertainOrder(order)).resolves.toBe(UncertainOrderResolution.UNRESOLVED);
      expect(scryptService.findWithdrawal).toHaveBeenCalledWith('dfx-lm-4711');
    });

    it('reports SENT for a withdraw order the venue does know', async () => {
      jest
        .spyOn(scryptService, 'findWithdrawal')
        .mockResolvedValue({ ClReqID: 'dfx-lm-4711' } as ScryptBalanceTransaction);
      const order = createUncertainSellOrder({
        action: withdrawAction(),
      });

      await expect(adapter.resolveUncertainOrder(order)).resolves.toBe(UncertainOrderResolution.SENT);
    });

    it('finds a claimed replacement the venue accepted but never confirmed, and tracks its reference', async () => {
      // the amend boundary: the original is unknown to the venue, the claimed replacement is live
      jest
        .spyOn(scryptService, 'getOrderStatus')
        .mockImplementation(async (id: string) => (id === 'dfx-lm-4711-1' ? venueOrder(id) : null));
      const order = createUncertainSellOrder();
      order.recordSpentCorrelationId('dfx-lm-4711-1');

      await expect(adapter.resolveUncertainOrder(order)).resolves.toBe(UncertainOrderResolution.SENT);
      expect(order.correlationId).toBe('dfx-lm-4711-1');
    });

    it('reports NOT_SENT when every reference this order sent was rejected — nothing is live', async () => {
      jest
        .spyOn(scryptService, 'getOrderStatus')
        .mockImplementation(async (id: string) => venueOrder(id, ScryptOrderStatus.REJECTED));
      const order = createUncertainSellOrder();
      order.recordSpentCorrelationId('dfx-lm-4711-1');

      await expect(adapter.resolveUncertainOrder(order)).resolves.toBe(UncertainOrderResolution.NOT_SENT);
    });

    it('checks the reference that was actually sent, never a synthesised future one', async () => {
      // regression guard: reconciling a freshly quarantined order used to start at an unsent reference,
      // stop on its meaningless absence, and never look at the one that had really gone out
      const seen: string[] = [];
      jest.spyOn(scryptService, 'getOrderStatus').mockImplementation(async (id: string) => {
        seen.push(id);
        return venueOrder(id);
      });

      await expect(adapter.resolveUncertainOrder(createUncertainSellOrder())).resolves.toBe(
        UncertainOrderResolution.SENT,
      );
      expect(seen).toEqual(['dfx-lm-4711']);
    });

    it('stays quarantined when a claimed replacement is not (yet) visible, even if the predecessor is', async () => {
      // an accepted replacement may lag in the venue's view; falling back to the order it replaced would
      // report SENT on a superseded reference and leave the live replacement untracked
      jest
        .spyOn(scryptService, 'getOrderStatus')
        .mockImplementation(async (id: string) => (id === 'dfx-lm-4711' ? venueOrder(id) : null));
      const order = createUncertainSellOrder();
      order.recordSpentCorrelationId('dfx-lm-4711-1');

      await expect(adapter.resolveUncertainOrder(order)).resolves.toBe(UncertainOrderResolution.UNRESOLVED);
    });

    it('falls back to the predecessor only after the replacement was explicitly rejected', async () => {
      jest
        .spyOn(scryptService, 'getOrderStatus')
        .mockImplementation(async (id: string) =>
          venueOrder(id, id === 'dfx-lm-4711-1' ? ScryptOrderStatus.REJECTED : ScryptOrderStatus.NEW),
        );
      const order = createUncertainSellOrder();
      order.recordSpentCorrelationId('dfx-lm-4711-1');

      await expect(adapter.resolveUncertainOrder(order)).resolves.toBe(UncertainOrderResolution.SENT);
      expect(order.correlationId).toBe('dfx-lm-4711');
    });

    it('prefers the replacement when BOTH it and the superseded original still exist', async () => {
      // The replaced order lingers at the venue in a cancelled state. Matching it first would report SENT
      // and leave the live replacement untracked, with the completion check polling a dead reference.
      jest.spyOn(scryptService, 'getOrderStatus').mockImplementation(async (id: string) => venueOrder(id));
      const order = createUncertainSellOrder();
      order.recordSpentCorrelationId('dfx-lm-4711-1');

      await expect(adapter.resolveUncertainOrder(order)).resolves.toBe(UncertainOrderResolution.SENT);
      expect(order.correlationId).toBe('dfx-lm-4711-1');
    });

    it("bounds the fallback fetch by the order's creation date, with one day of margin", async () => {
      // a reference cannot be published before the order that reserved it existed, so the venue lookup for
      // a recent order has no business pulling a month of history
      const getOrderStatus = jest.spyOn(scryptService, 'getOrderStatus').mockResolvedValue(venueOrder('dfx-lm-4711'));
      const order = createUncertainSellOrder();

      await adapter.resolveUncertainOrder(order);

      expect(getOrderStatus).toHaveBeenCalledWith('dfx-lm-4711', Util.daysBefore(1, order.created));
    });

    it('never widens the fetch window past the previous fixed 30 days, however old the order', async () => {
      const getOrderStatus = jest.spyOn(scryptService, 'getOrderStatus').mockResolvedValue(venueOrder('dfx-lm-4711'));
      const order = createUncertainSellOrder({ created: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) });

      // the 30-day bound is derived from "now", so pin it from both sides instead of comparing exact dates
      const earliest = Util.daysBefore(30);
      await adapter.resolveUncertainOrder(order);
      const latest = Util.daysBefore(30);

      const [, since] = getOrderStatus.mock.calls[0];
      expect(since?.getTime()).toBeGreaterThanOrEqual(earliest.getTime());
      expect(since?.getTime()).toBeLessThanOrEqual(latest.getTime());
    });
  });
});
