import { createMock } from '@golevelup/ts-jest';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ScryptTransactionStatus, ScryptWithdrawStatus } from 'src/integration/exchange/dto/scrypt.dto';
import {
  ScryptAmendRejectedError,
  ScryptOrderNotFoundError,
  ScryptRequestTimeoutError,
  ScryptUnconfirmedWriteError,
  ScryptVenueRejectionError,
} from 'src/integration/exchange/services/scrypt-websocket-connection';
import { ScryptService } from 'src/integration/exchange/services/scrypt.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
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
    updated: new Date(Date.now() - 30 * 60 * 1000),
    action: { command: ScryptAdapterCommands.SELL, paramMap: {} },
    ...overrides,
  });
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
      jest.spyOn(scryptService, 'getOrderStatus').mockResolvedValue({ id: 'dfx-lm-4711' } as any);

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

    it('stays UNRESOLVED when the lookup itself fails — an unreachable venue is not evidence', async () => {
      jest.spyOn(scryptService, 'getOrderStatus').mockRejectedValue(new Error('Connection closed'));

      await expect(adapter.resolveUncertainOrder(createUncertainSellOrder())).resolves.toBe(
        UncertainOrderResolution.UNRESOLVED,
      );
    });

    it('stays UNRESOLVED when no reference was ever reserved', async () => {
      const order = createUncertainSellOrder({ correlationId: undefined });

      await expect(adapter.resolveUncertainOrder(order)).resolves.toBe(UncertainOrderResolution.UNRESOLVED);
    });

    it('uses the withdrawal lookup for withdraw orders', async () => {
      jest.spyOn(scryptService, 'findWithdrawal').mockResolvedValue(null);
      const order = createUncertainSellOrder({
        action: { command: ScryptAdapterCommands.WITHDRAW, paramMap: {} } as any,
      });

      await expect(adapter.resolveUncertainOrder(order)).resolves.toBe(UncertainOrderResolution.UNRESOLVED);
      expect(scryptService.findWithdrawal).toHaveBeenCalledWith('dfx-lm-4711');
    });

    it('reports SENT for a withdraw order the venue does know', async () => {
      jest.spyOn(scryptService, 'findWithdrawal').mockResolvedValue({ ClReqID: 'dfx-lm-4711' } as any);
      const order = createUncertainSellOrder({
        action: { command: ScryptAdapterCommands.WITHDRAW, paramMap: {} } as any,
      });

      await expect(adapter.resolveUncertainOrder(order)).resolves.toBe(UncertainOrderResolution.SENT);
    });

    it('finds a replacement the venue accepted but never confirmed, and tracks its reference', async () => {
      // the amend boundary: the original is unknown to the venue, the replacement is live
      jest
        .spyOn(scryptService, 'getOrderStatus')
        .mockImplementation(async (id: string) => (id === 'dfx-lm-4711-1' ? ({ id } as any) : null));
      const order = createUncertainSellOrder();

      await expect(adapter.resolveUncertainOrder(order)).resolves.toBe(UncertainOrderResolution.SENT);
      expect(order.correlationId).toBe('dfx-lm-4711-1');
    });

    it('prefers the replacement when BOTH it and the superseded original still exist', async () => {
      // The replaced order lingers at the venue in a cancelled state. Matching it first would report SENT
      // and leave the live replacement untracked, with the completion check polling a dead reference.
      jest.spyOn(scryptService, 'getOrderStatus').mockImplementation(async (id: string) => ({ id }) as any);
      const order = createUncertainSellOrder();

      await expect(adapter.resolveUncertainOrder(order)).resolves.toBe(UncertainOrderResolution.SENT);
      expect(order.correlationId).toBe('dfx-lm-4711-1');
    });
  });
});
