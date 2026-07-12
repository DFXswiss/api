import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { createCustomPayoutOrder } from '../../../entities/__mocks__/payout-order.entity.mock';
import { PayoutOrder, PayoutOrderStatus } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutEvmService } from '../../../services/payout-evm.service';
import { EvmStrategy } from '../impl/base/evm.strategy';
import { PayoutStrategy } from '../impl/base/payout.strategy';
import { PayoutStrategyRegistry } from '../impl/base/payout.strategy-registry';

describe('PayoutStrategy (base)', () => {
  describe('#designateBeforeBroadcast(...)', () => {
    let strategy: TestStrategyWrapper;
    let payoutOrderRepo: PayoutOrderRepository;

    beforeEach(() => {
      payoutOrderRepo = mock<PayoutOrderRepository>();

      strategy = new TestStrategyWrapper();
    });

    it('designates and persists the order when payoutTxId is not yet set', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED, payoutTxId: null });
      const designateSpy = jest.spyOn(order, 'designatePayout');

      await strategy.callDesignateBeforeBroadcast(order, payoutOrderRepo);

      expect(designateSpy).toHaveBeenCalledTimes(1);
      expect(payoutOrderRepo.save).toHaveBeenCalledTimes(1);
      expect(payoutOrderRepo.save).toHaveBeenCalledWith(order);
      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_DESIGNATED);
    });

    it('does not designate nor persist the order when payoutTxId is already set', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'OLD_TX' });
      const designateSpy = jest.spyOn(order, 'designatePayout');

      await strategy.callDesignateBeforeBroadcast(order, payoutOrderRepo);

      expect(designateSpy).not.toHaveBeenCalled();
      expect(payoutOrderRepo.save).not.toHaveBeenCalled();
      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
    });
  });

  describe('#supportsSpeedup', () => {
    it('defaults to false on the base strategy', () => {
      const strategy = new TestStrategyWrapper();

      expect(strategy.supportsSpeedup).toBe(false);
    });

    it('is overridden to true on EvmStrategy', () => {
      const payoutEvmService = mock<PayoutEvmService>();
      const payoutOrderRepo = mock<PayoutOrderRepository>();
      const strategy = new EvmStrategyWrapper(payoutEvmService, payoutOrderRepo);

      expect(strategy.supportsSpeedup).toBe(true);
    });
  });

  describe('#onModuleInit(...) / #onModuleDestroy(...)', () => {
    let strategy: TestStrategyWrapper;
    let registry: PayoutStrategyRegistry;

    beforeEach(() => {
      strategy = new TestStrategyWrapper();
      registry = mock<PayoutStrategyRegistry>();

      // registry is an @Inject() readonly property on PayoutStrategy; there is no DI in the unit
      // test, so define it directly on the instance (direct assignment fails on a readonly field).
      Object.defineProperty(strategy, 'registry', { value: registry, configurable: true });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('registers itself with the payout strategy registry on module init', () => {
      strategy.onModuleInit();

      expect(registry.add).toHaveBeenCalledWith(
        { blockchain: Blockchain.BITCOIN, assetType: AssetType.COIN },
        strategy,
      );
    });

    it('deregisters itself from the payout strategy registry on module destroy', () => {
      strategy.onModuleDestroy();

      expect(registry.remove).toHaveBeenCalledWith({ blockchain: Blockchain.BITCOIN, assetType: AssetType.COIN });
    });
  });

  describe('#canRetryFailedPayout(...)', () => {
    it('defaults to false on the base strategy (whitelist approach: no retry unless overridden)', async () => {
      const strategy = new TestStrategyWrapper();
      const order = createCustomPayoutOrder({});

      await expect(strategy.canRetryFailedPayout(order)).resolves.toBe(false);
    });
  });

  describe('#feeAsset(...)', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('resolves the fee asset via getFeeAsset() once and caches it on subsequent calls', async () => {
      const strategy = new TestStrategyWrapper();
      const asset = createDefaultAsset();
      const getFeeAssetSpy = jest.spyOn(strategy as any, 'getFeeAsset').mockResolvedValue(asset);

      const first = await strategy.feeAsset();
      const second = await strategy.feeAsset();

      expect(first).toBe(asset);
      expect(second).toBe(asset);
      expect(getFeeAssetSpy).toHaveBeenCalledTimes(1);
    });
  });
});

class TestStrategyWrapper extends PayoutStrategy {
  get blockchain(): Blockchain {
    return Blockchain.BITCOIN;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  async doPayout(_orders: PayoutOrder[]): Promise<void> {
    throw new Error('Method not implemented.');
  }

  async checkPayoutCompletionData(_orders: PayoutOrder[]): Promise<void> {
    throw new Error('Method not implemented.');
  }

  async estimateFee(): Promise<FeeResult> {
    throw new Error('Method not implemented.');
  }

  async estimateBlockchainFee(): Promise<FeeResult> {
    throw new Error('Method not implemented.');
  }

  protected async getFeeAsset(): Promise<Asset> {
    throw new Error('Method not implemented.');
  }

  async callDesignateBeforeBroadcast(order: PayoutOrder, repo: PayoutOrderRepository): Promise<void> {
    return this.designateBeforeBroadcast(order, repo);
  }
}

class EvmStrategyWrapper extends EvmStrategy {
  get blockchain(): Blockchain {
    return Blockchain.ETHEREUM;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected dispatchPayout(_order: PayoutOrder): Promise<string> {
    throw new Error('Method not implemented.');
  }

  protected getCurrentGasForTransaction(): Promise<number> {
    return Promise.resolve(0);
  }

  protected getFeeAsset(): Promise<Asset> {
    throw new Error('Method not implemented.');
  }
}
