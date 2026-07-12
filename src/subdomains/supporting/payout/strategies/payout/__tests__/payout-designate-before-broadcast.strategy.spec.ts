import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { createCustomPayoutOrder } from '../../../entities/__mocks__/payout-order.entity.mock';
import { PayoutOrder, PayoutOrderStatus } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutArkadeService } from '../../../services/payout-arkade.service';
import { PayoutCardanoService } from '../../../services/payout-cardano.service';
import { PayoutEvmService } from '../../../services/payout-evm.service';
import { PayoutInternetComputerService } from '../../../services/payout-icp.service';
import { PayoutLightningService } from '../../../services/payout-lightning.service';
import { PayoutSolanaService } from '../../../services/payout-solana.service';
import { PayoutSparkService } from '../../../services/payout-spark.service';
import { PayoutTronService } from '../../../services/payout-tron.service';
import { ArkadeStrategy } from '../impl/arkade.strategy';
import { EvmStrategy } from '../impl/base/evm.strategy';
import { CardanoCoinStrategy } from '../impl/cardano-coin.strategy';
import { InternetComputerCoinStrategy } from '../impl/icp-coin.strategy';
import { LightningStrategy } from '../impl/lightning.strategy';
import { SolanaCoinStrategy } from '../impl/solana-coin.strategy';
import { SparkStrategy } from '../impl/spark.strategy';
import { TronCoinStrategy } from '../impl/tron-coin.strategy';

// Fixture returned by every per-strategy setup function below: a strategy instance whose
// broadcast sink (dispatchPayout/sendTransaction/sendPayment) and persistence sink
// (payoutOrderRepo.save) are individually spy-able, so the shared variant suite can drive and
// assert designate-before-broadcast behavior identically across all eight strategies.
interface DesignateBeforeBroadcastFixture {
  doPayout: (orders: PayoutOrder[]) => Promise<void>;
  dispatchSpy: jest.SpyInstance;
  repoSaveSpy: jest.SpyInstance;
}

// Shared table of the four designate-before-broadcast variants, run identically against every
// strategy's fixture. Kept as real, individually-named it() blocks (not a silent for-loop) so a
// failure in one strategy/variant combination is reported on its own line.
function runDesignateBeforeBroadcastSuite(strategyName: string, setup: () => DesignateBeforeBroadcastFixture): void {
  describe(`${strategyName} #doPayout(...)`, () => {
    it('designates and persists BEFORE broadcasting, then reaches PAYOUT_PENDING with the new txId', async () => {
      const { doPayout, dispatchSpy, repoSaveSpy } = setup();
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED, payoutTxId: null });

      // capture the persisted status at the moment of the first (pre-broadcast) save
      let statusAtFirstSave: PayoutOrderStatus | undefined;
      repoSaveSpy.mockImplementationOnce(async (o: PayoutOrder) => {
        statusAtFirstSave = o.status;
        return o;
      });
      dispatchSpy.mockResolvedValue('TX_NEW');

      await doPayout([order]);

      expect(statusAtFirstSave).toBe(PayoutOrderStatus.PAYOUT_DESIGNATED);
      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
      expect(order.payoutTxId).toBe('TX_NEW');
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      expect(repoSaveSpy).toHaveBeenCalledTimes(2); // designate + pending
    });

    it('leaves the order PAYOUT_DESIGNATED (no txId, no rollback) when the broadcast throws', async () => {
      const { doPayout, dispatchSpy, repoSaveSpy } = setup();
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED, payoutTxId: null });
      const rollbackSpy = jest.spyOn(order, 'rollbackPayoutDesignation');
      dispatchSpy.mockRejectedValue(new Error('broadcast failed'));

      await doPayout([order]);

      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_DESIGNATED);
      expect(order.payoutTxId).toBeNull();
      expect(dispatchSpy).toHaveBeenCalledTimes(1); // no second broadcast
      expect(rollbackSpy).not.toHaveBeenCalled(); // fail-closed: never auto-rollback after broadcast
      expect(repoSaveSpy).toHaveBeenCalledTimes(1); // only the pre-broadcast designate save
    });

    it('does NOT re-designate when payoutTxId is already set (speedup/expired-retry path)', async () => {
      const { doPayout, dispatchSpy, repoSaveSpy } = setup();
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'OLD_TX' });
      const designateSpy = jest.spyOn(order, 'designatePayout');
      dispatchSpy.mockResolvedValue('NEW_TX');

      await doPayout([order]);

      expect(designateSpy).not.toHaveBeenCalled();
      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
      expect(order.payoutTxId).toBe('NEW_TX');
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      expect(repoSaveSpy).toHaveBeenCalledTimes(1); // only the pending save, no extra designate save
    });

    it('never broadcasts when the pre-broadcast designate save throws', async () => {
      const { doPayout, dispatchSpy, repoSaveSpy } = setup();
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED, payoutTxId: null });
      repoSaveSpy.mockRejectedValueOnce(new Error('DB unavailable'));

      // doPayout must swallow the error (fail-closed logging), never let it escape
      await expect(doPayout([order])).resolves.toBeUndefined();

      expect(repoSaveSpy).toHaveBeenCalledTimes(1);
      expect(dispatchSpy).not.toHaveBeenCalled(); // broadcast is never reached
      // order.designatePayout() already ran synchronously before the rejected save, so the
      // in-memory object is PAYOUT_DESIGNATED even though nothing was ever persisted - it never
      // advances to PAYOUT_PENDING/txId, which is what matters for not being double-broadcast.
      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_DESIGNATED);
      expect(order.payoutTxId).toBeNull();
    });
  });
}

function repoSaveEcho(payoutOrderRepo: PayoutOrderRepository): jest.SpyInstance {
  return jest.spyOn(payoutOrderRepo, 'save').mockImplementation(async (o) => o as PayoutOrder);
}

function setupEvm(): DesignateBeforeBroadcastFixture {
  const payoutEvmService = mock<PayoutEvmService>();
  const payoutOrderRepo = mock<PayoutOrderRepository>();
  const dispatchFn = jest.fn();
  const repoSaveSpy = repoSaveEcho(payoutOrderRepo);

  const strategy = new EvmStrategyWrapper(payoutEvmService, payoutOrderRepo, dispatchFn);

  return { doPayout: (orders) => strategy.doPayout(orders), dispatchSpy: dispatchFn, repoSaveSpy };
}

function setupSolana(): DesignateBeforeBroadcastFixture {
  const solanaService = mock<PayoutSolanaService>();
  const assetService = mock<AssetService>();
  const payoutOrderRepo = mock<PayoutOrderRepository>();
  const dispatchSpy = jest.spyOn(solanaService, 'sendNativeCoin');
  const repoSaveSpy = repoSaveEcho(payoutOrderRepo);

  const strategy = new SolanaCoinStrategy(solanaService, assetService, payoutOrderRepo);

  return { doPayout: (orders) => strategy.doPayout(orders), dispatchSpy, repoSaveSpy };
}

function setupTron(): DesignateBeforeBroadcastFixture {
  const tronService = mock<PayoutTronService>();
  const assetService = mock<AssetService>();
  const payoutOrderRepo = mock<PayoutOrderRepository>();
  const dispatchSpy = jest.spyOn(tronService, 'sendNativeCoin');
  const repoSaveSpy = repoSaveEcho(payoutOrderRepo);

  const strategy = new TronCoinStrategy(tronService, assetService, payoutOrderRepo);

  return { doPayout: (orders) => strategy.doPayout(orders), dispatchSpy, repoSaveSpy };
}

function setupCardano(): DesignateBeforeBroadcastFixture {
  const cardanoService = mock<PayoutCardanoService>();
  const assetService = mock<AssetService>();
  const payoutOrderRepo = mock<PayoutOrderRepository>();
  const dispatchSpy = jest.spyOn(cardanoService, 'sendNativeCoin');
  const repoSaveSpy = repoSaveEcho(payoutOrderRepo);

  const strategy = new CardanoCoinStrategy(cardanoService, assetService, payoutOrderRepo);

  return { doPayout: (orders) => strategy.doPayout(orders), dispatchSpy, repoSaveSpy };
}

function setupIcp(): DesignateBeforeBroadcastFixture {
  const internetComputerService = mock<PayoutInternetComputerService>();
  const assetService = mock<AssetService>();
  const payoutOrderRepo = mock<PayoutOrderRepository>();
  const dispatchSpy = jest.spyOn(internetComputerService, 'sendNativeCoin');
  const repoSaveSpy = repoSaveEcho(payoutOrderRepo);

  const strategy = new InternetComputerCoinStrategy(internetComputerService, assetService, payoutOrderRepo);

  return { doPayout: (orders) => strategy.doPayout(orders), dispatchSpy, repoSaveSpy };
}

function setupArkade(): DesignateBeforeBroadcastFixture {
  const arkadeService = mock<PayoutArkadeService>();
  const payoutOrderRepo = mock<PayoutOrderRepository>();
  const assetService = mock<AssetService>();
  const dispatchSpy = jest.spyOn(arkadeService, 'sendTransaction');
  const repoSaveSpy = repoSaveEcho(payoutOrderRepo);

  const strategy = new ArkadeStrategy(arkadeService, payoutOrderRepo, assetService);

  return { doPayout: (orders) => strategy.doPayout(orders), dispatchSpy, repoSaveSpy };
}

function setupSpark(): DesignateBeforeBroadcastFixture {
  const sparkService = mock<PayoutSparkService>();
  const payoutOrderRepo = mock<PayoutOrderRepository>();
  const assetService = mock<AssetService>();
  const dispatchSpy = jest.spyOn(sparkService, 'sendTransaction');
  const repoSaveSpy = repoSaveEcho(payoutOrderRepo);

  const strategy = new SparkStrategy(sparkService, payoutOrderRepo, assetService);

  return { doPayout: (orders) => strategy.doPayout(orders), dispatchSpy, repoSaveSpy };
}

function setupLightning(): DesignateBeforeBroadcastFixture {
  const assetService = mock<AssetService>();
  const payoutLightningService = mock<PayoutLightningService>();
  const payoutOrderRepo = mock<PayoutOrderRepository>();
  jest.spyOn(payoutLightningService, 'isHealthy').mockResolvedValue(true);
  const dispatchSpy = jest.spyOn(payoutLightningService, 'sendPayment');
  const repoSaveSpy = repoSaveEcho(payoutOrderRepo);

  const strategy = new LightningStrategy(assetService, payoutLightningService, payoutOrderRepo);

  return { doPayout: (orders) => strategy.doPayout(orders), dispatchSpy, repoSaveSpy };
}

describe('Payout designate-before-broadcast', () => {
  runDesignateBeforeBroadcastSuite('EvmStrategy', setupEvm);
  runDesignateBeforeBroadcastSuite('SolanaStrategy (SolanaCoinStrategy)', setupSolana);
  runDesignateBeforeBroadcastSuite('TronStrategy (TronCoinStrategy)', setupTron);
  runDesignateBeforeBroadcastSuite('CardanoStrategy (CardanoCoinStrategy)', setupCardano);
  runDesignateBeforeBroadcastSuite('IcpStrategy (InternetComputerCoinStrategy)', setupIcp);
  runDesignateBeforeBroadcastSuite('ArkadeStrategy', setupArkade);
  runDesignateBeforeBroadcastSuite('SparkStrategy', setupSpark);
  runDesignateBeforeBroadcastSuite('LightningStrategy', setupLightning);

  describe('LightningStrategy #doPayout(...) — health gate', () => {
    it('designates nothing, broadcasts nothing and saves nothing when isHealthy() is false', async () => {
      const assetService = mock<AssetService>();
      const payoutLightningService = mock<PayoutLightningService>();
      const payoutOrderRepo = mock<PayoutOrderRepository>();
      jest.spyOn(payoutLightningService, 'isHealthy').mockResolvedValue(false);
      const sendPaymentSpy = jest.spyOn(payoutLightningService, 'sendPayment');
      const repoSaveSpy = repoSaveEcho(payoutOrderRepo);

      const strategy = new LightningStrategy(assetService, payoutLightningService, payoutOrderRepo);
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PREPARATION_CONFIRMED, payoutTxId: null });
      const designateSpy = jest.spyOn(order, 'designatePayout');

      await strategy.doPayout([order]);

      expect(designateSpy).not.toHaveBeenCalled();
      expect(sendPaymentSpy).not.toHaveBeenCalled();
      expect(repoSaveSpy).not.toHaveBeenCalled();
      expect(order.status).toBe(PayoutOrderStatus.PREPARATION_CONFIRMED);
      expect(order.payoutTxId).toBeNull();
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
