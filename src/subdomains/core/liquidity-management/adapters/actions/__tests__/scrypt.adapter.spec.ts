import { createMock } from '@golevelup/ts-jest';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ScryptTransactionStatus, ScryptWithdrawStatus } from 'src/integration/exchange/dto/scrypt.dto';
import { ScryptRequestTimeoutError } from 'src/integration/exchange/services/scrypt-websocket-connection';
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
    // old enough that absence counts as evidence; the grace window is 10 minutes
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

    it('leaves a dropped connection as an ordinary error — it proves the request never completed', () => {
      const dropped = new Error('Connection closed');

      const classified = adapter['classifySendOutcome'](dropped, 'sell of 1 EUR to USDT');

      expect(classified).toBe(dropped);
      expect(classified).not.toBeInstanceOf(OrderOutcomeUnknownException);
    });
  });

  describe('resolveUncertainOrder', () => {
    it('reports SENT when the venue knows the reference', async () => {
      jest.spyOn(scryptService, 'getOrderStatus').mockResolvedValue({ id: 'dfx-lm-4711' } as any);

      await expect(adapter.resolveUncertainOrder(createUncertainSellOrder())).resolves.toBe(
        UncertainOrderResolution.SENT,
      );
    });

    it('reports NOT_SENT only once the venue has had time to register the request', async () => {
      jest.spyOn(scryptService, 'getOrderStatus').mockResolvedValue(null);

      await expect(adapter.resolveUncertainOrder(createUncertainSellOrder())).resolves.toBe(
        UncertainOrderResolution.NOT_SENT,
      );
    });

    it('stays UNRESOLVED inside the grace window, when absence proves nothing yet', async () => {
      jest.spyOn(scryptService, 'getOrderStatus').mockResolvedValue(null);
      const fresh = createUncertainSellOrder({ updated: new Date() });

      await expect(adapter.resolveUncertainOrder(fresh)).resolves.toBe(UncertainOrderResolution.UNRESOLVED);
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

      await expect(adapter.resolveUncertainOrder(order)).resolves.toBe(UncertainOrderResolution.NOT_SENT);
      expect(scryptService.findWithdrawal).toHaveBeenCalledWith('dfx-lm-4711');
    });
  });
});
