import { mock } from 'jest-mock-extended';
import { Config, ConfigService } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import * as processServiceModule from 'src/shared/services/process.service';
import { PayoutTxStatus } from 'src/subdomains/supporting/payout/interfaces';
import {
  PriceCurrency,
  PriceValidity,
  PricingService,
} from 'src/subdomains/supporting/pricing/services/pricing.service';
import { createCustomPayoutOrder } from '../../../entities/__mocks__/payout-order.entity.mock';
import { PayoutOrder, PayoutOrderStatus } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutEvmService } from '../../../services/payout-evm.service';
import { EvmStrategy } from '../impl/base/evm.strategy';

describe('Payout EVM retry x designate-before-broadcast guard', () => {
  describe('EvmStrategy #checkPayoutCompletionData(...)', () => {
    let strategy: EvmStrategyWrapper;
    let payoutEvmService: PayoutEvmService;
    let payoutOrderRepo: PayoutOrderRepository;
    let pricingService: PricingService;
    let dispatchFn: jest.Mock;
    let repoSaveSpy: jest.SpyInstance;
    let convertFn: jest.Mock;

    beforeEach(() => {
      new ConfigService(); // sets the module-level Config (Config.defaultVolumeDecimal used by recordPayoutFee)
      payoutEvmService = mock<PayoutEvmService>();
      payoutOrderRepo = mock<PayoutOrderRepository>();
      pricingService = mock<PricingService>();
      dispatchFn = jest.fn();
      repoSaveSpy = jest.spyOn(payoutOrderRepo, 'save').mockImplementation(async (o) => o as PayoutOrder);

      // TX_SPEEDUP is fail-closed (disabled) by default in tests; enable it so nonce reuse/fresh-nonce
      // behaviour of getOrderNonce(...) is actually observable.
      jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(false);

      strategy = new EvmStrategyWrapper(payoutEvmService, payoutOrderRepo, dispatchFn);
      // pricingService is an @Inject() readonly property on PayoutStrategy; there is no DI in the
      // unit test, so define it directly on the instance.
      Object.defineProperty(strategy, 'pricingService', { value: pricingService, configurable: true });
      convertFn = jest.fn().mockReturnValue(42);
      jest.spyOn(pricingService, 'getPrice').mockResolvedValue({ convert: convertFn } as any);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('(a) complete: records the payout fee, completes the order and persists once', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'TX_OK' });
      const status: PayoutTxStatus = { state: 'complete', fee: 0.001 };
      jest.spyOn(payoutEvmService, 'getPayoutCompletionData').mockResolvedValue(status);
      const completeSpy = jest.spyOn(order, 'complete');
      const recordFeeSpy = jest.spyOn(order, 'recordPayoutFee');
      const designateSpy = jest.spyOn(order, 'designatePayout');
      const rollbackSpy = jest.spyOn(order, 'rollbackPayout');

      await strategy.checkPayoutCompletionData([order]);

      expect(payoutEvmService.getPayoutCompletionData).toHaveBeenCalledWith('TX_OK');
      expect(pricingService.getPrice).toHaveBeenCalledWith(expect.any(Asset), PriceCurrency.CHF, PriceValidity.ANY);
      expect(completeSpy).toHaveBeenCalledTimes(1);
      expect(convertFn).toHaveBeenCalledWith(0.001, Config.defaultVolumeDecimal);
      expect(recordFeeSpy).toHaveBeenCalledTimes(1);
      expect(recordFeeSpy).toHaveBeenCalledWith(expect.any(Asset), 0.001, 42);
      expect(order.status).toBe(PayoutOrderStatus.COMPLETE);
      expect(designateSpy).not.toHaveBeenCalled();
      expect(rollbackSpy).not.toHaveBeenCalled();
      expect(dispatchFn).not.toHaveBeenCalled();
      expect(payoutEvmService.getTxNonce).not.toHaveBeenCalled();
      expect(repoSaveSpy).toHaveBeenCalledTimes(1);
    });

    it('(b) failed, not out-of-gas (on-chain revert): designates for investigation, never retries', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'TX_REVERT' });
      const status: PayoutTxStatus = { state: 'failed', isOutOfGas: false };
      jest.spyOn(payoutEvmService, 'getPayoutCompletionData').mockResolvedValue(status);
      const completeSpy = jest.spyOn(order, 'complete');
      const designateSpy = jest.spyOn(order, 'designatePayout');
      const rollbackSpy = jest.spyOn(order, 'rollbackPayout');

      await strategy.checkPayoutCompletionData([order]);

      expect(designateSpy).toHaveBeenCalledTimes(1);
      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_DESIGNATED);
      expect(order.payoutTxId).toBe('TX_REVERT'); // txId kept for investigation, not cleared
      expect(completeSpy).not.toHaveBeenCalled();
      expect(rollbackSpy).not.toHaveBeenCalled();
      expect(dispatchFn).not.toHaveBeenCalled();
      expect(payoutEvmService.getTxNonce).not.toHaveBeenCalled();
      expect(repoSaveSpy).toHaveBeenCalledTimes(1);
    });

    it('(c) failed, out-of-gas + retryable: rolls back, re-designates and dispatches with a fresh nonce', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'TX_OOG' });
      const status: PayoutTxStatus = { state: 'failed', isOutOfGas: true };
      jest.spyOn(payoutEvmService, 'getPayoutCompletionData').mockResolvedValue(status);
      const rollbackSpy = jest.spyOn(order, 'rollbackPayout');
      const designateSpy = jest.spyOn(order, 'designatePayout');
      const completeSpy = jest.spyOn(order, 'complete');
      dispatchFn.mockResolvedValue('TX_NEW_OOG');

      await strategy.checkPayoutCompletionData([order]);

      // OOG frees the spent nonce: rollback clears payoutTxId, so the guard sees a fresh order and re-designates.
      expect(rollbackSpy).toHaveBeenCalledTimes(1);
      expect(designateSpy).toHaveBeenCalledTimes(1);
      expect(completeSpy).not.toHaveBeenCalled();
      expect(dispatchFn).toHaveBeenCalledTimes(1);
      expect(dispatchFn).toHaveBeenCalledWith(order, undefined); // fresh (unset) nonce, no reuse
      expect(payoutEvmService.getTxNonce).not.toHaveBeenCalled(); // fresh nonce, no reuse
      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
      expect(order.payoutTxId).toBe('TX_NEW_OOG');
      expect(repoSaveSpy).toHaveBeenCalledTimes(3); // rollback save + designate save + pending save
    });

    it('(d) expired in mempool + retryable: keeps payoutTxId, skips re-designation and reuses the nonce', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'TX_OLD' });
      order.updated = new Date(Date.now() - 2 * 60 * 60 * 1000); // > 1h ago, so the retry cooldown has elapsed
      const status: PayoutTxStatus = { state: 'pending' };
      jest.spyOn(payoutEvmService, 'getPayoutCompletionData').mockResolvedValue(status);
      jest.spyOn(payoutEvmService, 'isTxExpired').mockResolvedValue(true);
      jest.spyOn(payoutEvmService, 'getTxNonce').mockResolvedValue(7);
      const rollbackSpy = jest.spyOn(order, 'rollbackPayout');
      const designateSpy = jest.spyOn(order, 'designatePayout');
      const completeSpy = jest.spyOn(order, 'complete');
      dispatchFn.mockResolvedValue('TX_NEW_EXPIRED');

      await strategy.checkPayoutCompletionData([order]);

      expect(payoutEvmService.isTxExpired).toHaveBeenCalledWith('TX_OLD');
      // Guard: payoutTxId was never cleared, so designateBeforeBroadcast skips re-designation.
      expect(designateSpy).not.toHaveBeenCalled();
      expect(rollbackSpy).not.toHaveBeenCalled();
      expect(completeSpy).not.toHaveBeenCalled();
      expect(payoutEvmService.getTxNonce).toHaveBeenCalledWith('TX_OLD'); // nonce reuse
      expect(dispatchFn).toHaveBeenCalledTimes(1);
      expect(dispatchFn).toHaveBeenCalledWith(order, 7);
      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
      expect(order.payoutTxId).toBe('TX_NEW_EXPIRED');
      expect(repoSaveSpy).toHaveBeenCalledTimes(1); // only the final pending save, no pre-broadcast designate save
    });

    it('(e) pending: no status change, no completion, no designation, no rollback, no dispatch', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'TX_PENDING' });
      order.updated = new Date(); // < 1h ago: retry cooldown has not elapsed
      const status: PayoutTxStatus = { state: 'pending' };
      jest.spyOn(payoutEvmService, 'getPayoutCompletionData').mockResolvedValue(status);
      const completeSpy = jest.spyOn(order, 'complete');
      const designateSpy = jest.spyOn(order, 'designatePayout');
      const rollbackSpy = jest.spyOn(order, 'rollbackPayout');

      await strategy.checkPayoutCompletionData([order]);

      expect(completeSpy).not.toHaveBeenCalled();
      expect(designateSpy).not.toHaveBeenCalled();
      expect(rollbackSpy).not.toHaveBeenCalled();
      expect(dispatchFn).not.toHaveBeenCalled();
      expect(payoutEvmService.isTxExpired).not.toHaveBeenCalled(); // cooldown short-circuits before the chain check
      expect(payoutEvmService.getTxNonce).not.toHaveBeenCalled();
      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
      expect(order.payoutTxId).toBe('TX_PENDING');
      expect(repoSaveSpy).not.toHaveBeenCalled();
    });
  });

  describe('EvmStrategy #canRetryFailedPayout(...)', () => {
    let strategy: EvmStrategyWrapper;

    beforeEach(() => {
      const payoutEvmService = mock<PayoutEvmService>();
      const payoutOrderRepo = mock<PayoutOrderRepository>();
      strategy = new EvmStrategyWrapper(payoutEvmService, payoutOrderRepo, jest.fn());
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('returns false when the order has no payoutTxId (nothing broadcast yet, nothing to retry)', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: null });

      await expect(strategy.canRetryFailedPayout(order)).resolves.toBe(false);
    });
  });
});

class EvmStrategyWrapper extends EvmStrategy {
  constructor(
    payoutEvmService: PayoutEvmService,
    payoutOrderRepo: PayoutOrderRepository,
    private readonly dispatchFn: jest.Mock,
  ) {
    super(payoutEvmService, payoutOrderRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.ETHEREUM;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected async dispatchPayout(order: PayoutOrder): Promise<string> {
    // Mirrors the real EVM subclasses (e.g. EthereumCoinStrategy#dispatchPayout), which fetch the
    // order nonce right before broadcasting - this is the interaction under test.
    const nonce = await this.getOrderNonce(order);

    return this.dispatchFn(order, nonce);
  }

  protected getCurrentGasForTransaction(): Promise<number> {
    return Promise.resolve(0);
  }

  protected getFeeAsset(): Promise<Asset> {
    return Promise.resolve(createDefaultAsset());
  }
}
