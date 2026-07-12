import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { createCustomPayoutOrder } from '../../../entities/__mocks__/payout-order.entity.mock';
import { PayoutOrder, PayoutOrderStatus } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutArkadeService } from '../../../services/payout-arkade.service';
import { PayoutEvmService } from '../../../services/payout-evm.service';
import { ArkadeStrategy } from '../impl/arkade.strategy';
import { EvmStrategy } from '../impl/base/evm.strategy';

describe('Payout designate-before-broadcast', () => {
  describe('EvmStrategy #doPayout(...)', () => {
    let strategy: EvmStrategyWrapper;
    let payoutEvmService: PayoutEvmService;
    let payoutOrderRepo: PayoutOrderRepository;
    let dispatchFn: jest.Mock;
    let repoSaveSpy: jest.SpyInstance;

    beforeEach(() => {
      payoutEvmService = mock<PayoutEvmService>();
      payoutOrderRepo = mock<PayoutOrderRepository>();
      dispatchFn = jest.fn();
      repoSaveSpy = jest.spyOn(payoutOrderRepo, 'save').mockImplementation(async (o) => o as PayoutOrder);

      strategy = new EvmStrategyWrapper(payoutEvmService, payoutOrderRepo, dispatchFn);
    });

    it('designates and persists BEFORE broadcasting so the order is not re-selectable on reboot', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED, payoutTxId: null });

      // capture the persisted status at the moment of the first (pre-broadcast) save
      let statusAtFirstSave: PayoutOrderStatus | undefined;
      repoSaveSpy.mockImplementationOnce(async (o: PayoutOrder) => {
        statusAtFirstSave = o.status;
        return o;
      });
      dispatchFn.mockResolvedValue('TX_NEW');

      await strategy.doPayout([order]);

      expect(statusAtFirstSave).toBe(PayoutOrderStatus.PAYOUT_DESIGNATED);
      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
      expect(order.payoutTxId).toBe('TX_NEW');
      expect(dispatchFn).toHaveBeenCalledTimes(1);
      expect(repoSaveSpy).toHaveBeenCalledTimes(2); // designate + pending
    });

    it('leaves the order PAYOUT_DESIGNATED (no txId, no rollback) when the broadcast throws', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED, payoutTxId: null });
      const rollbackSpy = jest.spyOn(order, 'rollbackPayoutDesignation');
      dispatchFn.mockRejectedValue(new Error('RPC broadcast failed'));

      await strategy.doPayout([order]);

      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_DESIGNATED);
      expect(order.payoutTxId).toBeNull();
      expect(dispatchFn).toHaveBeenCalledTimes(1); // no second broadcast
      expect(rollbackSpy).not.toHaveBeenCalled(); // fail-closed: never auto-rollback after broadcast
      expect(repoSaveSpy).toHaveBeenCalledTimes(1); // only the pre-broadcast designate save
    });

    it('does NOT re-designate when payoutTxId is already set (TX_SPEEDUP/expired-retry path)', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'OLD_TX' });
      const designateSpy = jest.spyOn(order, 'designatePayout');
      dispatchFn.mockResolvedValue('NEW_TX');

      await strategy.doPayout([order]);

      expect(designateSpy).not.toHaveBeenCalled();
      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
      expect(order.payoutTxId).toBe('NEW_TX');
      expect(dispatchFn).toHaveBeenCalledTimes(1);
      expect(repoSaveSpy).toHaveBeenCalledTimes(1); // only the pending save, no extra designate save
    });
  });

  describe('ArkadeStrategy #doPayout(...)', () => {
    let strategy: ArkadeStrategy;
    let arkadeService: PayoutArkadeService;
    let payoutOrderRepo: PayoutOrderRepository;
    let assetService: AssetService;
    let sendTransactionSpy: jest.SpyInstance;
    let repoSaveSpy: jest.SpyInstance;

    beforeEach(() => {
      arkadeService = mock<PayoutArkadeService>();
      payoutOrderRepo = mock<PayoutOrderRepository>();
      assetService = mock<AssetService>();

      sendTransactionSpy = jest.spyOn(arkadeService, 'sendTransaction');
      repoSaveSpy = jest.spyOn(payoutOrderRepo, 'save').mockImplementation(async (o) => o as PayoutOrder);

      strategy = new ArkadeStrategy(arkadeService, payoutOrderRepo, assetService);
    });

    it('designates before broadcasting and reaches PAYOUT_PENDING on success', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED, payoutTxId: null });

      let statusAtFirstSave: PayoutOrderStatus | undefined;
      repoSaveSpy.mockImplementationOnce(async (o: PayoutOrder) => {
        statusAtFirstSave = o.status;
        return o;
      });
      sendTransactionSpy.mockResolvedValue('ARK_TX');

      await strategy.doPayout([order]);

      expect(statusAtFirstSave).toBe(PayoutOrderStatus.PAYOUT_DESIGNATED);
      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
      expect(order.payoutTxId).toBe('ARK_TX');
      expect(sendTransactionSpy).toHaveBeenCalledTimes(1);
      expect(repoSaveSpy).toHaveBeenCalledTimes(2);
    });

    it('leaves the order PAYOUT_DESIGNATED when the broadcast throws', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED, payoutTxId: null });
      sendTransactionSpy.mockRejectedValue(new Error('Arkade send failed'));

      await strategy.doPayout([order]);

      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_DESIGNATED);
      expect(order.payoutTxId).toBeNull();
      expect(sendTransactionSpy).toHaveBeenCalledTimes(1);
      expect(repoSaveSpy).toHaveBeenCalledTimes(1);
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

  protected dispatchPayout(order: PayoutOrder): Promise<string> {
    return this.dispatchFn(order);
  }

  protected getCurrentGasForTransaction(): Promise<number> {
    return Promise.resolve(0);
  }

  protected getFeeAsset(): Promise<Asset> {
    throw new Error('Method not implemented.');
  }
}
