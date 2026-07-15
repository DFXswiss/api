import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { createCustomPayoutOrder } from '../../../entities/__mocks__/payout-order.entity.mock';
import { PayoutOrder, PayoutOrderContext, PayoutOrderStatus } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutGroup } from '../../../services/base/payout-bitcoin-based.service';
import { PayoutZanoService } from '../../../services/payout-zano.service';
import { ZanoStrategy } from '../impl/base/zano.strategy';

describe('ZanoStrategy', () => {
  let strategy: ZanoStrategyWrapper;

  let notificationService: NotificationService;
  let payoutOrderRepo: PayoutOrderRepository;
  let payoutZanoService: PayoutZanoService;
  let assetService: AssetService;

  let repoSaveSpy: jest.SpyInstance;

  beforeEach(() => {
    notificationService = mock<NotificationService>();
    payoutOrderRepo = mock<PayoutOrderRepository>();
    payoutZanoService = mock<PayoutZanoService>();
    assetService = mock<AssetService>();

    repoSaveSpy = jest.spyOn(payoutOrderRepo, 'save').mockImplementation(async (o) => o as PayoutOrder);

    strategy = new ZanoStrategyWrapper(notificationService, payoutOrderRepo, payoutZanoService, assetService);
  });

  it('exposes the Zano blockchain and a COIN asset type', () => {
    expect(strategy.blockchain).toBe(Blockchain.ZANO);
    expect(strategy.assetType).toBe(AssetType.COIN);
  });

  describe('#estimateFee(...)', () => {
    it('returns the Zano fee asset and the service estimated fee', async () => {
      const feeAsset = createCustomAsset({ name: 'ZANO' });
      jest.spyOn(assetService, 'getZanoCoin').mockResolvedValue(feeAsset);
      jest.spyOn(payoutZanoService, 'getEstimatedFee').mockReturnValue(0.01);

      const result = await strategy.estimateFee();

      expect(payoutZanoService.getEstimatedFee).toHaveBeenCalledTimes(1);
      expect(assetService.getZanoCoin).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ asset: feeAsset, amount: 0.01 });
    });
  });

  describe('#getFeeAsset(...)', () => {
    it('delegates to AssetService#getZanoCoin()', async () => {
      const feeAsset = createCustomAsset({ name: 'ZANO' });
      jest.spyOn(assetService, 'getZanoCoin').mockResolvedValue(feeAsset);

      const result = await strategy.getFeeAsset();

      expect(assetService.getZanoCoin).toHaveBeenCalledTimes(1);
      expect(result).toBe(feeAsset);
    });
  });

  describe('#doPayoutForContext(...)', () => {
    it('pays out a group with sufficient unlocked balance via send(...)', async () => {
      const orders = [
        createCustomPayoutOrder({
          id: 1,
          status: PayoutOrderStatus.PREPARATION_CONFIRMED,
          payoutTxId: null,
          destinationAddress: 'ADDR_01',
          amount: 1,
        }),
      ];
      jest.spyOn(strategy, 'hasEnoughUnlockedBalanceImpl').mockResolvedValue(true);
      const dispatchSpy = jest.spyOn(strategy, 'dispatchPayoutImpl').mockResolvedValue('ZANO_TX');
      const loggerVerboseSpy = jest.spyOn((strategy as any).logger, 'verbose');

      await strategy.doPayoutForContextWrapper(PayoutOrderContext.BUY_CRYPTO, orders);

      expect(loggerVerboseSpy).toHaveBeenCalled();
      expect(dispatchSpy).toHaveBeenCalledWith(
        PayoutOrderContext.BUY_CRYPTO,
        [{ addressTo: 'ADDR_01', amount: 1 }],
        orders[0].asset,
      );
      expect(orders[0].status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
      expect(orders[0].payoutTxId).toBe('ZANO_TX');
      expect(repoSaveSpy).toHaveBeenCalled();
    });

    it('logs and does not send when the unlocked balance is insufficient', async () => {
      const orders = [createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED, payoutTxId: null })];
      jest.spyOn(strategy, 'hasEnoughUnlockedBalanceImpl').mockResolvedValue(false);
      const dispatchSpy = jest.spyOn(strategy, 'dispatchPayoutImpl');
      const loggerInfoSpy = jest.spyOn((strategy as any).logger, 'info');

      await strategy.doPayoutForContextWrapper(PayoutOrderContext.BUY_CRYPTO, orders);

      expect(loggerInfoSpy).toHaveBeenCalledWith(expect.stringContaining('Insufficient unlocked balance'));
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('skips empty payout groups (defensive guard) and only processes non-empty ones', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED, payoutTxId: null });
      // createPayoutGroups never emits an empty group for real input, so force one to reach the guard.
      jest.spyOn(strategy as any, 'createPayoutGroups').mockReturnValue([[], [order]]);
      const hasBalanceSpy = jest.spyOn(strategy, 'hasEnoughUnlockedBalanceImpl').mockResolvedValue(false);

      await strategy.doPayoutForContextWrapper(PayoutOrderContext.BUY_CRYPTO, [order]);

      expect(hasBalanceSpy).toHaveBeenCalledTimes(1);
      expect(hasBalanceSpy).toHaveBeenCalledWith([order]);
    });

    it('catches an error from a group and continues without throwing', async () => {
      const orders = [createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED, payoutTxId: null })];
      jest.spyOn(strategy, 'hasEnoughUnlockedBalanceImpl').mockRejectedValue(new Error('balance rpc down'));
      const loggerErrorSpy = jest.spyOn((strategy as any).logger, 'error');

      await expect(strategy.doPayoutForContextWrapper(PayoutOrderContext.BUY_CRYPTO, orders)).resolves.toBeUndefined();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error in paying out a group'),
        expect.any(Error),
      );
    });
  });
});

class ZanoStrategyWrapper extends ZanoStrategy {
  protected readonly logger = new DfxLogger(ZanoStrategyWrapper);

  get blockchain(): Blockchain {
    return Blockchain.ZANO;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  // Overridable per-test spy target for the abstract balance check.
  hasEnoughUnlockedBalanceImpl: (orders: PayoutOrder[]) => Promise<boolean> = () => Promise.resolve(true);

  async hasEnoughUnlockedBalance(orders: PayoutOrder[]): Promise<boolean> {
    return this.hasEnoughUnlockedBalanceImpl(orders);
  }

  // Overridable per-test so #send(...) tests can simulate a chain dispatch without a real client.
  dispatchPayoutImpl: (context: PayoutOrderContext, payout: PayoutGroup, token?: Asset) => Promise<string> = () =>
    Promise.resolve('ZANO_TX');

  async dispatchPayout(context: PayoutOrderContext, payout: PayoutGroup, token?: Asset): Promise<string> {
    return this.dispatchPayoutImpl(context, payout, token);
  }

  doPayoutForContextWrapper(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    return this.doPayoutForContext(context, orders);
  }
}
