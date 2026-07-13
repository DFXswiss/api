import { NotImplementedException } from '@nestjs/common';
import { mock } from 'jest-mock-extended';
import { Config, ConfigService } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import {
  PriceCurrency,
  PriceValidity,
  PricingService,
} from 'src/subdomains/supporting/pricing/services/pricing.service';
import { createCustomPayoutOrder } from '../../../entities/__mocks__/payout-order.entity.mock';
import { PayoutOrderStatus } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutArkadeService } from '../../../services/payout-arkade.service';
import { PayoutLightningService } from '../../../services/payout-lightning.service';
import { PayoutSparkService } from '../../../services/payout-spark.service';
import { ArkadeStrategy } from '../impl/arkade.strategy';
import { LightningStrategy } from '../impl/lightning.strategy';
import { SparkStrategy } from '../impl/spark.strategy';

// Leaf-strategy coverage for the three non-EVM/non-Bitcoin-based strategies that implement
// FeeResult estimation and completion tracking directly (no shared base class): Arkade, Spark
// and Lightning. doPayout/designate-before-broadcast is already covered by
// payout-designate-before-broadcast.strategy.spec.ts - this file targets the remaining
// estimateFee/estimateBlockchainFee, checkPayoutCompletionData and the protected
// getFeeAsset/getCurrentGasForTransaction helpers.

class ArkadeStrategyWrapper extends ArkadeStrategy {
  getFeeAssetWrapper(): Promise<Asset> {
    return this.getFeeAsset();
  }

  getCurrentGasForTransactionWrapper(token: Asset): Promise<number> {
    return this.getCurrentGasForTransaction(token);
  }
}

class SparkStrategyWrapper extends SparkStrategy {
  getFeeAssetWrapper(): Promise<Asset> {
    return this.getFeeAsset();
  }

  getCurrentGasForTransactionWrapper(token: Asset): Promise<number> {
    return this.getCurrentGasForTransaction(token);
  }
}

describe('Payout leaf strategies - estimateFee & completion', () => {
  beforeEach(() => {
    new ConfigService(); // sets the module-level Config (Config.defaultVolumeDecimal used by recordPayoutFee)
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('ArkadeStrategy', () => {
    let arkadeService: PayoutArkadeService;
    let payoutOrderRepo: PayoutOrderRepository;
    let assetService: AssetService;
    let pricingService: PricingService;
    let strategy: ArkadeStrategyWrapper;
    let feeAsset: Asset;
    let repoSaveSpy: jest.SpyInstance;

    beforeEach(() => {
      arkadeService = mock<PayoutArkadeService>();
      payoutOrderRepo = mock<PayoutOrderRepository>();
      assetService = mock<AssetService>();
      pricingService = mock<PricingService>();
      feeAsset = createCustomAsset({ name: 'ARKADE_BTC' });
      jest.spyOn(assetService, 'getArkadeCoin').mockResolvedValue(feeAsset);
      repoSaveSpy = jest.spyOn(payoutOrderRepo, 'save').mockImplementation(async (o) => o as any);

      strategy = new ArkadeStrategyWrapper(arkadeService, payoutOrderRepo, assetService);
      Object.defineProperty(strategy, 'pricingService', { value: pricingService, configurable: true });
    });

    it('exposes the Arkade blockchain and a COIN asset type', () => {
      expect(strategy.blockchain).toBe(Blockchain.ARKADE);
      expect(strategy.assetType).toBe(AssetType.COIN);
    });

    it('estimateFee() resolves the fee asset via AssetService and returns a zero amount', async () => {
      const result = await strategy.estimateFee();

      expect(assetService.getArkadeCoin).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ asset: feeAsset, amount: 0 });
    });

    it('estimateBlockchainFee(...) delegates to estimateFee() regardless of the passed asset', async () => {
      const someAsset = createCustomAsset({ name: 'IRRELEVANT' });
      const estimateFeeSpy = jest.spyOn(strategy, 'estimateFee');

      const result = await strategy.estimateBlockchainFee(someAsset);

      expect(estimateFeeSpy).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ asset: feeAsset, amount: 0 });
    });

    it('getFeeAsset() delegates to AssetService#getArkadeCoin()', async () => {
      const result = await strategy.getFeeAssetWrapper();

      expect(assetService.getArkadeCoin).toHaveBeenCalledTimes(1);
      expect(result).toBe(feeAsset);
    });

    it('getCurrentGasForTransaction(...) delegates to PayoutArkadeService#getCurrentFeeForTransaction(...)', async () => {
      jest.spyOn(arkadeService, 'getCurrentFeeForTransaction').mockResolvedValue(123);

      const result = await strategy.getCurrentGasForTransactionWrapper(feeAsset);

      expect(arkadeService.getCurrentFeeForTransaction).toHaveBeenCalledWith(feeAsset);
      expect(result).toBe(123);
    });

    it('getPayoutCompletionData(...) delegates to PayoutArkadeService#getPayoutCompletionData(...)', async () => {
      jest.spyOn(arkadeService, 'getPayoutCompletionData').mockResolvedValue([true, 0.0005]);

      const result = await strategy.getPayoutCompletionData('TX_ARKADE');

      expect(arkadeService.getPayoutCompletionData).toHaveBeenCalledWith('TX_ARKADE');
      expect(result).toEqual([true, 0.0005]);
    });

    describe('#checkPayoutCompletionData(...)', () => {
      it('complete: records the payout fee (via pricingService/Config), completes the order and persists once', async () => {
        const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'TX_ARK_OK' });
        jest.spyOn(arkadeService, 'getPayoutCompletionData').mockResolvedValue([true, 0.0007]);
        const convertFn = jest.fn().mockReturnValue(21);
        jest.spyOn(pricingService, 'getPrice').mockResolvedValue({ convert: convertFn } as any);
        const completeSpy = jest.spyOn(order, 'complete');
        const recordFeeSpy = jest.spyOn(order, 'recordPayoutFee');

        await strategy.checkPayoutCompletionData([order]);

        expect(arkadeService.getPayoutCompletionData).toHaveBeenCalledWith('TX_ARK_OK');
        expect(pricingService.getPrice).toHaveBeenCalledWith(feeAsset, PriceCurrency.CHF, PriceValidity.ANY);
        expect(completeSpy).toHaveBeenCalledTimes(1);
        expect(convertFn).toHaveBeenCalledWith(0.0007, Config.defaultVolumeDecimal);
        expect(recordFeeSpy).toHaveBeenCalledWith(feeAsset, 0.0007, 21);
        expect(order.status).toBe(PayoutOrderStatus.COMPLETE);
        expect(repoSaveSpy).toHaveBeenCalledTimes(1);
      });

      it('not complete: leaves the order untouched and does not persist', async () => {
        const order = createCustomPayoutOrder({
          status: PayoutOrderStatus.PAYOUT_PENDING,
          payoutTxId: 'TX_ARK_PENDING',
        });
        jest.spyOn(arkadeService, 'getPayoutCompletionData').mockResolvedValue([false, 0]);
        const completeSpy = jest.spyOn(order, 'complete');
        const recordFeeSpy = jest.spyOn(order, 'recordPayoutFee');

        await strategy.checkPayoutCompletionData([order]);

        expect(completeSpy).not.toHaveBeenCalled();
        expect(recordFeeSpy).not.toHaveBeenCalled();
        expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
        expect(repoSaveSpy).not.toHaveBeenCalled();
      });

      it('swallows errors from getPayoutCompletionData and never persists', async () => {
        const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'TX_ARK_ERR' });
        jest.spyOn(arkadeService, 'getPayoutCompletionData').mockRejectedValue(new Error('arkade node unreachable'));
        const completeSpy = jest.spyOn(order, 'complete');

        await expect(strategy.checkPayoutCompletionData([order])).resolves.toBeUndefined();

        expect(completeSpy).not.toHaveBeenCalled();
        expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
        expect(repoSaveSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe('SparkStrategy', () => {
    let sparkService: PayoutSparkService;
    let payoutOrderRepo: PayoutOrderRepository;
    let assetService: AssetService;
    let pricingService: PricingService;
    let strategy: SparkStrategyWrapper;
    let feeAsset: Asset;
    let repoSaveSpy: jest.SpyInstance;

    beforeEach(() => {
      sparkService = mock<PayoutSparkService>();
      payoutOrderRepo = mock<PayoutOrderRepository>();
      assetService = mock<AssetService>();
      pricingService = mock<PricingService>();
      feeAsset = createCustomAsset({ name: 'SPARK_BTC' });
      jest.spyOn(assetService, 'getSparkCoin').mockResolvedValue(feeAsset);
      repoSaveSpy = jest.spyOn(payoutOrderRepo, 'save').mockImplementation(async (o) => o as any);

      strategy = new SparkStrategyWrapper(sparkService, payoutOrderRepo, assetService);
      Object.defineProperty(strategy, 'pricingService', { value: pricingService, configurable: true });
    });

    it('exposes the Spark blockchain and a COIN asset type', () => {
      expect(strategy.blockchain).toBe(Blockchain.SPARK);
      expect(strategy.assetType).toBe(AssetType.COIN);
    });

    it('estimateFee() resolves the fee asset via AssetService and returns a zero amount', async () => {
      const result = await strategy.estimateFee();

      expect(assetService.getSparkCoin).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ asset: feeAsset, amount: 0 });
    });

    it('estimateBlockchainFee(...) delegates to estimateFee() regardless of the passed asset', async () => {
      const someAsset = createCustomAsset({ name: 'IRRELEVANT' });
      const estimateFeeSpy = jest.spyOn(strategy, 'estimateFee');

      const result = await strategy.estimateBlockchainFee(someAsset);

      expect(estimateFeeSpy).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ asset: feeAsset, amount: 0 });
    });

    it('getFeeAsset() delegates to AssetService#getSparkCoin()', async () => {
      const result = await strategy.getFeeAssetWrapper();

      expect(assetService.getSparkCoin).toHaveBeenCalledTimes(1);
      expect(result).toBe(feeAsset);
    });

    it('getCurrentGasForTransaction(...) delegates to PayoutSparkService#getCurrentFeeForTransaction(...)', async () => {
      jest.spyOn(sparkService, 'getCurrentFeeForTransaction').mockResolvedValue(456);

      const result = await strategy.getCurrentGasForTransactionWrapper(feeAsset);

      expect(sparkService.getCurrentFeeForTransaction).toHaveBeenCalledWith(feeAsset);
      expect(result).toBe(456);
    });

    it('getPayoutCompletionData(...) delegates to PayoutSparkService#getPayoutCompletionData(...)', async () => {
      jest.spyOn(sparkService, 'getPayoutCompletionData').mockResolvedValue([true, 0.0003]);

      const result = await strategy.getPayoutCompletionData('TX_SPARK');

      expect(sparkService.getPayoutCompletionData).toHaveBeenCalledWith('TX_SPARK');
      expect(result).toEqual([true, 0.0003]);
    });

    describe('#checkPayoutCompletionData(...)', () => {
      it('complete: records the payout fee (via pricingService/Config), completes the order and persists once', async () => {
        const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'TX_SPK_OK' });
        jest.spyOn(sparkService, 'getPayoutCompletionData').mockResolvedValue([true, 0.0002]);
        const convertFn = jest.fn().mockReturnValue(13);
        jest.spyOn(pricingService, 'getPrice').mockResolvedValue({ convert: convertFn } as any);
        const completeSpy = jest.spyOn(order, 'complete');
        const recordFeeSpy = jest.spyOn(order, 'recordPayoutFee');

        await strategy.checkPayoutCompletionData([order]);

        expect(sparkService.getPayoutCompletionData).toHaveBeenCalledWith('TX_SPK_OK');
        expect(pricingService.getPrice).toHaveBeenCalledWith(feeAsset, PriceCurrency.CHF, PriceValidity.ANY);
        expect(completeSpy).toHaveBeenCalledTimes(1);
        expect(convertFn).toHaveBeenCalledWith(0.0002, Config.defaultVolumeDecimal);
        expect(recordFeeSpy).toHaveBeenCalledWith(feeAsset, 0.0002, 13);
        expect(order.status).toBe(PayoutOrderStatus.COMPLETE);
        expect(repoSaveSpy).toHaveBeenCalledTimes(1);
      });

      it('not complete: leaves the order untouched and does not persist', async () => {
        const order = createCustomPayoutOrder({
          status: PayoutOrderStatus.PAYOUT_PENDING,
          payoutTxId: 'TX_SPK_PENDING',
        });
        jest.spyOn(sparkService, 'getPayoutCompletionData').mockResolvedValue([false, 0]);
        const completeSpy = jest.spyOn(order, 'complete');
        const recordFeeSpy = jest.spyOn(order, 'recordPayoutFee');

        await strategy.checkPayoutCompletionData([order]);

        expect(completeSpy).not.toHaveBeenCalled();
        expect(recordFeeSpy).not.toHaveBeenCalled();
        expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
        expect(repoSaveSpy).not.toHaveBeenCalled();
      });

      it('swallows errors from getPayoutCompletionData and never persists', async () => {
        const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'TX_SPK_ERR' });
        jest.spyOn(sparkService, 'getPayoutCompletionData').mockRejectedValue(new Error('spark node unreachable'));
        const completeSpy = jest.spyOn(order, 'complete');

        await expect(strategy.checkPayoutCompletionData([order])).resolves.toBeUndefined();

        expect(completeSpy).not.toHaveBeenCalled();
        expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
        expect(repoSaveSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe('LightningStrategy', () => {
    let assetService: AssetService;
    let payoutLightningService: PayoutLightningService;
    let payoutOrderRepo: PayoutOrderRepository;
    let pricingService: PricingService;
    let strategy: LightningStrategy;
    let feeAsset: Asset;
    let repoSaveSpy: jest.SpyInstance;

    beforeEach(() => {
      assetService = mock<AssetService>();
      payoutLightningService = mock<PayoutLightningService>();
      payoutOrderRepo = mock<PayoutOrderRepository>();
      pricingService = mock<PricingService>();
      feeAsset = createCustomAsset({ name: 'LN_BTC' });
      jest.spyOn(assetService, 'getLightningCoin').mockResolvedValue(feeAsset);
      repoSaveSpy = jest.spyOn(payoutOrderRepo, 'save').mockImplementation(async (o) => o as any);

      strategy = new LightningStrategy(assetService, payoutLightningService, payoutOrderRepo);
      Object.defineProperty(strategy, 'pricingService', { value: pricingService, configurable: true });
    });

    it('exposes the Lightning blockchain (asset type is unset - LN has no on-chain asset distinction)', () => {
      expect(strategy.blockchain).toBe(Blockchain.LIGHTNING);
      expect(strategy.assetType).toBeUndefined();
    });

    describe('#estimateBlockchainFee(...)', () => {
      it('resolves the fee asset via getFeeAsset() and returns a zero amount', async () => {
        const result = await strategy.estimateBlockchainFee();

        expect(assetService.getLightningCoin).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ asset: feeAsset, amount: 0 });
      });
    });

    describe('#getFeeAsset(...)', () => {
      it('delegates to AssetService#getLightningCoin()', async () => {
        const result = await strategy.getFeeAsset();

        expect(assetService.getLightningCoin).toHaveBeenCalledTimes(1);
        expect(result).toBe(feeAsset);
      });
    });

    describe('#estimateFee(...)', () => {
      it('throws NotImplementedException when the target asset differs from the reference asset', async () => {
        const targetAsset = createCustomAsset({ id: 1 });
        const refAsset = createCustomAsset({ id: 2 });

        await expect(strategy.estimateFee(targetAsset, 'lnbc_addr', 1, refAsset)).rejects.toThrow(
          NotImplementedException,
        );
        expect(payoutLightningService.getEstimatedFee).not.toHaveBeenCalled();
      });

      it('estimates the fee via PayoutLightningService when target and reference asset match', async () => {
        const sameAsset = createCustomAsset({ id: 5 });
        jest.spyOn(payoutLightningService, 'getEstimatedFee').mockResolvedValue(0.00001);

        const result = await strategy.estimateFee(sameAsset, 'lnbc_addr', 1000, sameAsset);

        expect(payoutLightningService.getEstimatedFee).toHaveBeenCalledWith('lnbc_addr', 1000);
        expect(result).toEqual({ asset: feeAsset, amount: 0.00001 });
      });
    });

    describe('#checkPayoutCompletionData(...)', () => {
      it('health gate: does nothing when isHealthy() is false', async () => {
        jest.spyOn(payoutLightningService, 'isHealthy').mockResolvedValue(false);
        const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'TX_LN_SKIP' });
        const completeSpy = jest.spyOn(order, 'complete');

        await strategy.checkPayoutCompletionData([order]);

        expect(payoutLightningService.getPayoutCompletionData).not.toHaveBeenCalled();
        expect(completeSpy).not.toHaveBeenCalled();
        expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
        expect(repoSaveSpy).not.toHaveBeenCalled();
      });

      it('complete: records the payout fee (via pricingService/Config), completes the order and persists once', async () => {
        jest.spyOn(payoutLightningService, 'isHealthy').mockResolvedValue(true);
        jest.spyOn(payoutLightningService, 'getPayoutCompletionData').mockResolvedValue([true, 0.0000015]);
        const convertFn = jest.fn().mockReturnValue(7);
        jest.spyOn(pricingService, 'getPrice').mockResolvedValue({ convert: convertFn } as any);
        const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'TX_LN_OK' });
        const completeSpy = jest.spyOn(order, 'complete');
        const recordFeeSpy = jest.spyOn(order, 'recordPayoutFee');

        await strategy.checkPayoutCompletionData([order]);

        expect(payoutLightningService.getPayoutCompletionData).toHaveBeenCalledWith('TX_LN_OK');
        expect(pricingService.getPrice).toHaveBeenCalledWith(feeAsset, PriceCurrency.CHF, PriceValidity.ANY);
        expect(completeSpy).toHaveBeenCalledTimes(1);
        expect(convertFn).toHaveBeenCalledWith(0.0000015, Config.defaultVolumeDecimal);
        expect(recordFeeSpy).toHaveBeenCalledWith(feeAsset, 0.0000015, 7);
        expect(order.status).toBe(PayoutOrderStatus.COMPLETE);
        expect(repoSaveSpy).toHaveBeenCalledTimes(1);
      });

      it('not complete: leaves the order untouched and does not persist', async () => {
        jest.spyOn(payoutLightningService, 'isHealthy').mockResolvedValue(true);
        jest.spyOn(payoutLightningService, 'getPayoutCompletionData').mockResolvedValue([false, 0]);
        const order = createCustomPayoutOrder({
          status: PayoutOrderStatus.PAYOUT_PENDING,
          payoutTxId: 'TX_LN_PENDING',
        });
        const completeSpy = jest.spyOn(order, 'complete');
        const recordFeeSpy = jest.spyOn(order, 'recordPayoutFee');

        await strategy.checkPayoutCompletionData([order]);

        expect(completeSpy).not.toHaveBeenCalled();
        expect(recordFeeSpy).not.toHaveBeenCalled();
        expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
        expect(repoSaveSpy).not.toHaveBeenCalled();
      });

      it('swallows errors from getPayoutCompletionData and never persists', async () => {
        jest.spyOn(payoutLightningService, 'isHealthy').mockResolvedValue(true);
        jest
          .spyOn(payoutLightningService, 'getPayoutCompletionData')
          .mockRejectedValue(new Error('lightning node unreachable'));
        const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'TX_LN_ERR' });
        const completeSpy = jest.spyOn(order, 'complete');

        await expect(strategy.checkPayoutCompletionData([order])).resolves.toBeUndefined();

        expect(completeSpy).not.toHaveBeenCalled();
        expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
        expect(repoSaveSpy).not.toHaveBeenCalled();
      });
    });
  });
});
