import { mock } from 'jest-mock-extended';
import { Config, ConfigService } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { createCustomAsset, createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import {
  PriceCurrency,
  PriceValidity,
  PricingService,
} from 'src/subdomains/supporting/pricing/services/pricing.service';
import { createCustomPayoutOrder } from '../../../entities/__mocks__/payout-order.entity.mock';
import { PayoutOrder, PayoutOrderStatus } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutCardanoService } from '../../../services/payout-cardano.service';
import { PayoutEvmService } from '../../../services/payout-evm.service';
import { PayoutInternetComputerService } from '../../../services/payout-icp.service';
import { PayoutSolanaService } from '../../../services/payout-solana.service';
import { PayoutTronService } from '../../../services/payout-tron.service';
import { CardanoStrategy } from '../impl/base/cardano.strategy';
import { EvmStrategy } from '../impl/base/evm.strategy';
import { InternetComputerStrategy } from '../impl/base/icp.strategy';
import { SolanaStrategy } from '../impl/base/solana.strategy';
import { TronStrategy } from '../impl/base/tron.strategy';

function withPricingService(strategy: any, pricingService: PricingService): void {
  // pricingService is an @Inject() readonly property on PayoutStrategy; there is no DI in the
  // unit test, so define it directly on the instance.
  Object.defineProperty(strategy, 'pricingService', { value: pricingService, configurable: true });
}

describe('Payout strategy base classes - estimateFee / estimateBlockchainFee / checkPayoutCompletionData', () => {
  beforeEach(() => {
    new ConfigService(); // sets the module-level Config (Config.defaultVolumeDecimal used by recordPayoutFee)
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------------------------
  // EvmStrategy: estimateFee / estimateBlockchainFee only (checkPayoutCompletionData is fully
  // covered by payout-evm-retry.spec.ts and must not be duplicated here).
  // ---------------------------------------------------------------------------------------------
  describe('EvmStrategy', () => {
    let strategy: EvmStrategyWrapper;
    let payoutEvmService: PayoutEvmService;
    let payoutOrderRepo: PayoutOrderRepository;
    let feeAsset: Asset;

    beforeEach(() => {
      payoutEvmService = mock<PayoutEvmService>();
      payoutOrderRepo = mock<PayoutOrderRepository>();
      feeAsset = createDefaultAsset();
      strategy = new EvmStrategyWrapper(payoutEvmService, payoutOrderRepo, feeAsset);
    });

    it('estimateFee(...) resolves the gas via getCurrentGasForTransaction(...) and caches it per asset id', async () => {
      const asset = createCustomAsset({ id: 5 });
      const gasSpy = jest.spyOn(strategy, 'getCurrentGasForTransactionPublic').mockResolvedValue(0.002);

      const first: FeeResult = await strategy.estimateFee(asset);
      const second: FeeResult = await strategy.estimateFee(asset);

      expect(first).toEqual({ asset: feeAsset, amount: 0.002 });
      expect(second).toEqual({ asset: feeAsset, amount: 0.002 });
      expect(gasSpy).toHaveBeenCalledTimes(1); // AsyncCache: second call served from cache
      expect(gasSpy).toHaveBeenCalledWith(asset);

      const otherAsset = createCustomAsset({ id: 55 });
      const third: FeeResult = await strategy.estimateFee(otherAsset);

      expect(third).toEqual({ asset: feeAsset, amount: 0.002 });
      // different asset.id -> separate cache key -> cache miss -> a second real gas lookup
      expect(gasSpy).toHaveBeenCalledTimes(2);
      expect(gasSpy).toHaveBeenCalledWith(otherAsset);
    });

    it('estimateBlockchainFee(...) delegates to estimateFee(...)', async () => {
      const asset = createCustomAsset({ id: 6 });
      jest.spyOn(strategy, 'getCurrentGasForTransactionPublic').mockResolvedValue(0.003);
      const estimateFeeSpy = jest.spyOn(strategy, 'estimateFee');

      const result = await strategy.estimateBlockchainFee(asset);

      expect(result).toEqual({ asset: feeAsset, amount: 0.003 });
      expect(estimateFeeSpy).toHaveBeenCalledWith(asset);
    });

    it('checkPayoutCompletionData(...) catches and logs errors from getPayoutCompletionData(...) without throwing', async () => {
      const pricingService = mock<PricingService>();
      withPricingService(strategy, pricingService);
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'TX_ERR' });
      jest.spyOn(payoutEvmService, 'getPayoutCompletionData').mockRejectedValue(new Error('rpc unavailable'));
      const loggerErrorSpy = jest.spyOn((strategy as any).logger, 'error');
      const completeSpy = jest.spyOn(order, 'complete');

      await expect(strategy.checkPayoutCompletionData([order])).resolves.toBeUndefined();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Error in checking completion of EVM payout order ${order.id}`),
        expect.any(Error),
      );
      expect(completeSpy).not.toHaveBeenCalled();
      expect(payoutOrderRepo.save).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------------------------
  // SolanaStrategy
  // ---------------------------------------------------------------------------------------------
  describe('SolanaStrategy', () => {
    let strategy: SolanaStrategyWrapper;
    let solanaService: PayoutSolanaService;
    let payoutOrderRepo: PayoutOrderRepository;
    let pricingService: PricingService;
    let feeAsset: Asset;
    let convertFn: jest.Mock;

    beforeEach(() => {
      solanaService = mock<PayoutSolanaService>();
      payoutOrderRepo = mock<PayoutOrderRepository>();
      pricingService = mock<PricingService>();
      feeAsset = createDefaultAsset();
      strategy = new SolanaStrategyWrapper(solanaService, payoutOrderRepo, feeAsset);
      withPricingService(strategy, pricingService);
      convertFn = jest.fn().mockReturnValue(42);
      jest.spyOn(pricingService, 'getPrice').mockResolvedValue({ convert: convertFn } as any);
      jest.spyOn(payoutOrderRepo, 'save').mockImplementation(async (o) => o as PayoutOrder);
    });

    it('estimateFee(...) resolves the gas via getCurrentGasForTransaction(...) and caches it per asset id', async () => {
      const asset = createCustomAsset({ id: 11 });
      const gasSpy = jest.spyOn(strategy, 'getCurrentGasForTransactionPublic').mockResolvedValue(0.0001);

      const first = await strategy.estimateFee(asset);
      const second = await strategy.estimateFee(asset);

      expect(first).toEqual({ asset: feeAsset, amount: 0.0001 });
      expect(second).toEqual({ asset: feeAsset, amount: 0.0001 });
      expect(gasSpy).toHaveBeenCalledTimes(1);

      const otherAsset = createCustomAsset({ id: 111 });
      const third = await strategy.estimateFee(otherAsset);

      expect(third).toEqual({ asset: feeAsset, amount: 0.0001 });
      // different asset.id -> separate cache key -> cache miss -> a second real gas lookup
      expect(gasSpy).toHaveBeenCalledTimes(2);
      expect(gasSpy).toHaveBeenCalledWith(otherAsset);
    });

    it('estimateBlockchainFee(...) delegates to estimateFee(...)', async () => {
      const asset = createCustomAsset({ id: 12 });
      jest.spyOn(strategy, 'getCurrentGasForTransactionPublic').mockResolvedValue(0.0002);
      const estimateFeeSpy = jest.spyOn(strategy, 'estimateFee');

      const result = await strategy.estimateBlockchainFee(asset);

      expect(result).toEqual({ asset: feeAsset, amount: 0.0002 });
      expect(estimateFeeSpy).toHaveBeenCalledWith(asset);
    });

    it('checkPayoutCompletionData(...) completes the order, records the fee and persists once when complete', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'SOL_TX' });
      jest.spyOn(solanaService, 'getPayoutCompletionData').mockResolvedValue([true, 0.00005]);
      const completeSpy = jest.spyOn(order, 'complete');
      const recordFeeSpy = jest.spyOn(order, 'recordPayoutFee');

      await strategy.checkPayoutCompletionData([order]);

      expect(solanaService.getPayoutCompletionData).toHaveBeenCalledWith('SOL_TX');
      expect(pricingService.getPrice).toHaveBeenCalledWith(feeAsset, PriceCurrency.CHF, PriceValidity.ANY);
      expect(completeSpy).toHaveBeenCalledTimes(1);
      expect(convertFn).toHaveBeenCalledWith(0.00005, Config.defaultVolumeDecimal);
      expect(recordFeeSpy).toHaveBeenCalledWith(feeAsset, 0.00005, 42);
      expect(order.status).toBe(PayoutOrderStatus.COMPLETE);
      expect(payoutOrderRepo.save).toHaveBeenCalledTimes(1);
      expect(payoutOrderRepo.save).toHaveBeenCalledWith(order);
    });

    it('checkPayoutCompletionData(...) leaves the order untouched when not yet complete', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'SOL_TX_2' });
      jest.spyOn(solanaService, 'getPayoutCompletionData').mockResolvedValue([false, 0]);
      const completeSpy = jest.spyOn(order, 'complete');
      const recordFeeSpy = jest.spyOn(order, 'recordPayoutFee');

      await strategy.checkPayoutCompletionData([order]);

      expect(completeSpy).not.toHaveBeenCalled();
      expect(recordFeeSpy).not.toHaveBeenCalled();
      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
      expect(payoutOrderRepo.save).not.toHaveBeenCalled();
    });

    it('checkPayoutCompletionData(...) catches and logs errors without throwing', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'SOL_TX_ERR' });
      jest.spyOn(solanaService, 'getPayoutCompletionData').mockRejectedValue(new Error('rpc down'));
      const completeSpy = jest.spyOn(order, 'complete');

      await expect(strategy.checkPayoutCompletionData([order])).resolves.toBeUndefined();

      expect(completeSpy).not.toHaveBeenCalled();
      expect(payoutOrderRepo.save).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------------------------
  // TronStrategy
  // ---------------------------------------------------------------------------------------------
  describe('TronStrategy', () => {
    let strategy: TronStrategyWrapper;
    let tronService: PayoutTronService;
    let payoutOrderRepo: PayoutOrderRepository;
    let pricingService: PricingService;
    let feeAsset: Asset;
    let convertFn: jest.Mock;

    beforeEach(() => {
      tronService = mock<PayoutTronService>();
      payoutOrderRepo = mock<PayoutOrderRepository>();
      pricingService = mock<PricingService>();
      feeAsset = createDefaultAsset();
      strategy = new TronStrategyWrapper(tronService, payoutOrderRepo, feeAsset);
      withPricingService(strategy, pricingService);
      convertFn = jest.fn().mockReturnValue(7);
      jest.spyOn(pricingService, 'getPrice').mockResolvedValue({ convert: convertFn } as any);
      jest.spyOn(payoutOrderRepo, 'save').mockImplementation(async (o) => o as PayoutOrder);
    });

    it('estimateFee(...) resolves the gas via getCurrentGasForTransaction(...) and caches it per asset id', async () => {
      const asset = createCustomAsset({ id: 21 });
      const gasSpy = jest.spyOn(strategy, 'getCurrentGasForTransactionPublic').mockResolvedValue(1.5);

      const first = await strategy.estimateFee(asset);
      const second = await strategy.estimateFee(asset);

      expect(first).toEqual({ asset: feeAsset, amount: 1.5 });
      expect(second).toEqual({ asset: feeAsset, amount: 1.5 });
      expect(gasSpy).toHaveBeenCalledTimes(1);

      const otherAsset = createCustomAsset({ id: 121 });
      const third = await strategy.estimateFee(otherAsset);

      expect(third).toEqual({ asset: feeAsset, amount: 1.5 });
      // different asset.id -> separate cache key -> cache miss -> a second real gas lookup
      expect(gasSpy).toHaveBeenCalledTimes(2);
      expect(gasSpy).toHaveBeenCalledWith(otherAsset);
    });

    it('estimateBlockchainFee(...) delegates to estimateFee(...)', async () => {
      const asset = createCustomAsset({ id: 22 });
      jest.spyOn(strategy, 'getCurrentGasForTransactionPublic').mockResolvedValue(2.5);
      const estimateFeeSpy = jest.spyOn(strategy, 'estimateFee');

      const result = await strategy.estimateBlockchainFee(asset);

      expect(result).toEqual({ asset: feeAsset, amount: 2.5 });
      expect(estimateFeeSpy).toHaveBeenCalledWith(asset);
    });

    it('checkPayoutCompletionData(...) completes the order, records the fee and persists once when complete', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'TRX_TX' });
      jest.spyOn(tronService, 'getPayoutCompletionData').mockResolvedValue([true, 3.2]);
      const completeSpy = jest.spyOn(order, 'complete');
      const recordFeeSpy = jest.spyOn(order, 'recordPayoutFee');

      await strategy.checkPayoutCompletionData([order]);

      expect(tronService.getPayoutCompletionData).toHaveBeenCalledWith('TRX_TX');
      expect(pricingService.getPrice).toHaveBeenCalledWith(feeAsset, PriceCurrency.CHF, PriceValidity.ANY);
      expect(completeSpy).toHaveBeenCalledTimes(1);
      expect(convertFn).toHaveBeenCalledWith(3.2, Config.defaultVolumeDecimal);
      expect(recordFeeSpy).toHaveBeenCalledWith(feeAsset, 3.2, 7);
      expect(order.status).toBe(PayoutOrderStatus.COMPLETE);
      expect(payoutOrderRepo.save).toHaveBeenCalledTimes(1);
      expect(payoutOrderRepo.save).toHaveBeenCalledWith(order);
    });

    it('checkPayoutCompletionData(...) leaves the order untouched when not yet complete', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'TRX_TX_2' });
      jest.spyOn(tronService, 'getPayoutCompletionData').mockResolvedValue([false, 0]);
      const completeSpy = jest.spyOn(order, 'complete');
      const recordFeeSpy = jest.spyOn(order, 'recordPayoutFee');

      await strategy.checkPayoutCompletionData([order]);

      expect(completeSpy).not.toHaveBeenCalled();
      expect(recordFeeSpy).not.toHaveBeenCalled();
      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
      expect(payoutOrderRepo.save).not.toHaveBeenCalled();
    });

    it('checkPayoutCompletionData(...) catches and logs errors without throwing', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'TRX_TX_ERR' });
      jest.spyOn(tronService, 'getPayoutCompletionData').mockRejectedValue(new Error('node down'));
      const completeSpy = jest.spyOn(order, 'complete');

      await expect(strategy.checkPayoutCompletionData([order])).resolves.toBeUndefined();

      expect(completeSpy).not.toHaveBeenCalled();
      expect(payoutOrderRepo.save).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------------------------
  // CardanoStrategy
  // ---------------------------------------------------------------------------------------------
  describe('CardanoStrategy', () => {
    let strategy: CardanoStrategyWrapper;
    let cardanoService: PayoutCardanoService;
    let payoutOrderRepo: PayoutOrderRepository;
    let pricingService: PricingService;
    let feeAsset: Asset;
    let convertFn: jest.Mock;

    beforeEach(() => {
      cardanoService = mock<PayoutCardanoService>();
      payoutOrderRepo = mock<PayoutOrderRepository>();
      pricingService = mock<PricingService>();
      feeAsset = createDefaultAsset();
      strategy = new CardanoStrategyWrapper(cardanoService, payoutOrderRepo, feeAsset);
      withPricingService(strategy, pricingService);
      convertFn = jest.fn().mockReturnValue(3);
      jest.spyOn(pricingService, 'getPrice').mockResolvedValue({ convert: convertFn } as any);
      jest.spyOn(payoutOrderRepo, 'save').mockImplementation(async (o) => o as PayoutOrder);
    });

    it('estimateFee(...) resolves the gas via getCurrentGasForTransaction(...) and caches it per asset id', async () => {
      const asset = createCustomAsset({ id: 31 });
      const gasSpy = jest.spyOn(strategy, 'getCurrentGasForTransactionPublic').mockResolvedValue(0.17);

      const first = await strategy.estimateFee(asset);
      const second = await strategy.estimateFee(asset);

      expect(first).toEqual({ asset: feeAsset, amount: 0.17 });
      expect(second).toEqual({ asset: feeAsset, amount: 0.17 });
      expect(gasSpy).toHaveBeenCalledTimes(1);

      const otherAsset = createCustomAsset({ id: 131 });
      const third = await strategy.estimateFee(otherAsset);

      expect(third).toEqual({ asset: feeAsset, amount: 0.17 });
      // different asset.id -> separate cache key -> cache miss -> a second real gas lookup
      expect(gasSpy).toHaveBeenCalledTimes(2);
      expect(gasSpy).toHaveBeenCalledWith(otherAsset);
    });

    it('estimateBlockchainFee(...) delegates to estimateFee(...)', async () => {
      const asset = createCustomAsset({ id: 32 });
      jest.spyOn(strategy, 'getCurrentGasForTransactionPublic').mockResolvedValue(0.19);
      const estimateFeeSpy = jest.spyOn(strategy, 'estimateFee');

      const result = await strategy.estimateBlockchainFee(asset);

      expect(result).toEqual({ asset: feeAsset, amount: 0.19 });
      expect(estimateFeeSpy).toHaveBeenCalledWith(asset);
    });

    it('checkPayoutCompletionData(...) completes the order, records the fee and persists once when complete', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'ADA_TX' });
      jest.spyOn(cardanoService, 'getPayoutCompletionData').mockResolvedValue([true, 0.18]);
      const completeSpy = jest.spyOn(order, 'complete');
      const recordFeeSpy = jest.spyOn(order, 'recordPayoutFee');

      await strategy.checkPayoutCompletionData([order]);

      expect(cardanoService.getPayoutCompletionData).toHaveBeenCalledWith('ADA_TX');
      expect(pricingService.getPrice).toHaveBeenCalledWith(feeAsset, PriceCurrency.CHF, PriceValidity.ANY);
      expect(completeSpy).toHaveBeenCalledTimes(1);
      expect(convertFn).toHaveBeenCalledWith(0.18, Config.defaultVolumeDecimal);
      expect(recordFeeSpy).toHaveBeenCalledWith(feeAsset, 0.18, 3);
      expect(order.status).toBe(PayoutOrderStatus.COMPLETE);
      expect(payoutOrderRepo.save).toHaveBeenCalledTimes(1);
      expect(payoutOrderRepo.save).toHaveBeenCalledWith(order);
    });

    it('checkPayoutCompletionData(...) leaves the order untouched when not yet complete', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'ADA_TX_2' });
      jest.spyOn(cardanoService, 'getPayoutCompletionData').mockResolvedValue([false, 0]);
      const completeSpy = jest.spyOn(order, 'complete');
      const recordFeeSpy = jest.spyOn(order, 'recordPayoutFee');

      await strategy.checkPayoutCompletionData([order]);

      expect(completeSpy).not.toHaveBeenCalled();
      expect(recordFeeSpy).not.toHaveBeenCalled();
      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
      expect(payoutOrderRepo.save).not.toHaveBeenCalled();
    });

    it('checkPayoutCompletionData(...) catches and logs errors without throwing', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'ADA_TX_ERR' });
      jest.spyOn(cardanoService, 'getPayoutCompletionData').mockRejectedValue(new Error('node down'));
      const completeSpy = jest.spyOn(order, 'complete');

      await expect(strategy.checkPayoutCompletionData([order])).resolves.toBeUndefined();

      expect(completeSpy).not.toHaveBeenCalled();
      expect(payoutOrderRepo.save).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------------------------
  // InternetComputerStrategy (ICP): unlike the other chains, estimateFee(...) returns the *input*
  // asset (not this.feeAsset()) and checkPayoutCompletionData(...) uses order.asset directly as the
  // fee asset and forwards the order's asset to getPayoutCompletionData(...) only when it is a TOKEN.
  // ---------------------------------------------------------------------------------------------
  describe('InternetComputerStrategy', () => {
    let strategy: IcpStrategyWrapper;
    let internetComputerService: PayoutInternetComputerService;
    let payoutOrderRepo: PayoutOrderRepository;
    let pricingService: PricingService;
    let convertFn: jest.Mock;

    beforeEach(() => {
      internetComputerService = mock<PayoutInternetComputerService>();
      payoutOrderRepo = mock<PayoutOrderRepository>();
      pricingService = mock<PricingService>();
      strategy = new IcpStrategyWrapper(internetComputerService, payoutOrderRepo);
      withPricingService(strategy, pricingService);
      convertFn = jest.fn().mockReturnValue(9);
      jest.spyOn(pricingService, 'getPrice').mockResolvedValue({ convert: convertFn } as any);
      jest.spyOn(payoutOrderRepo, 'save').mockImplementation(async (o) => o as PayoutOrder);
    });

    it('estimateFee(...) resolves the gas via getCurrentGasForTransaction(...) and returns the *input* asset (not feeAsset())', async () => {
      const asset = createCustomAsset({ id: 41 });
      const gasSpy = jest.spyOn(strategy, 'getCurrentGasForTransactionPublic').mockResolvedValue(0.0004);

      const first = await strategy.estimateFee(asset);
      const second = await strategy.estimateFee(asset);

      expect(first).toEqual({ asset, amount: 0.0004 });
      expect(second).toEqual({ asset, amount: 0.0004 });
      expect(gasSpy).toHaveBeenCalledTimes(1); // AsyncCache: second call served from cache

      const otherAsset = createCustomAsset({ id: 141 });
      const third = await strategy.estimateFee(otherAsset);

      expect(third).toEqual({ asset: otherAsset, amount: 0.0004 });
      // different asset.id -> separate cache key -> cache miss -> a second real gas lookup
      expect(gasSpy).toHaveBeenCalledTimes(2);
      expect(gasSpy).toHaveBeenCalledWith(otherAsset);
    });

    it('estimateBlockchainFee(...) delegates to estimateFee(...)', async () => {
      const asset = createCustomAsset({ id: 42 });
      jest.spyOn(strategy, 'getCurrentGasForTransactionPublic').mockResolvedValue(0.0006);
      const estimateFeeSpy = jest.spyOn(strategy, 'estimateFee');

      const result = await strategy.estimateBlockchainFee(asset);

      expect(result).toEqual({ asset, amount: 0.0006 });
      expect(estimateFeeSpy).toHaveBeenCalledWith(asset);
    });

    it('checkPayoutCompletionData(...) forwards the order asset to getPayoutCompletionData(...) for a TOKEN order and records the fee via order.asset when complete', async () => {
      const tokenAsset = createCustomAsset({ id: 43, type: AssetType.TOKEN });
      const order = createCustomPayoutOrder({
        status: PayoutOrderStatus.PAYOUT_PENDING,
        payoutTxId: 'ICP_TOKEN_TX',
        asset: tokenAsset,
      });
      jest.spyOn(internetComputerService, 'getPayoutCompletionData').mockResolvedValue([true, 0.0009]);
      const completeSpy = jest.spyOn(order, 'complete');
      const recordFeeSpy = jest.spyOn(order, 'recordPayoutFee');

      await strategy.checkPayoutCompletionData([order]);

      expect(internetComputerService.getPayoutCompletionData).toHaveBeenCalledWith('ICP_TOKEN_TX', tokenAsset);
      expect(pricingService.getPrice).toHaveBeenCalledWith(tokenAsset, PriceCurrency.CHF, PriceValidity.ANY);
      expect(completeSpy).toHaveBeenCalledTimes(1);
      expect(convertFn).toHaveBeenCalledWith(0.0009, Config.defaultVolumeDecimal);
      expect(recordFeeSpy).toHaveBeenCalledWith(tokenAsset, 0.0009, 9);
      expect(order.status).toBe(PayoutOrderStatus.COMPLETE);
      expect(payoutOrderRepo.save).toHaveBeenCalledTimes(1);
    });

    it('checkPayoutCompletionData(...) passes undefined for a COIN order and still completes when complete', async () => {
      const coinAsset = createCustomAsset({ id: 44, type: AssetType.COIN });
      const order = createCustomPayoutOrder({
        status: PayoutOrderStatus.PAYOUT_PENDING,
        payoutTxId: 'ICP_COIN_TX',
        asset: coinAsset,
      });
      jest.spyOn(internetComputerService, 'getPayoutCompletionData').mockResolvedValue([true, 0.0001]);
      const completeSpy = jest.spyOn(order, 'complete');
      const recordFeeSpy = jest.spyOn(order, 'recordPayoutFee');

      await strategy.checkPayoutCompletionData([order]);

      expect(internetComputerService.getPayoutCompletionData).toHaveBeenCalledWith('ICP_COIN_TX', undefined);
      expect(completeSpy).toHaveBeenCalledTimes(1);
      expect(convertFn).toHaveBeenCalledWith(0.0001, Config.defaultVolumeDecimal);
      expect(recordFeeSpy).toHaveBeenCalledWith(coinAsset, 0.0001, 9);
      expect(payoutOrderRepo.save).toHaveBeenCalledTimes(1);
    });

    it('checkPayoutCompletionData(...) leaves the order untouched when not yet complete', async () => {
      const coinAsset = createCustomAsset({ id: 45, type: AssetType.COIN });
      const order = createCustomPayoutOrder({
        status: PayoutOrderStatus.PAYOUT_PENDING,
        payoutTxId: 'ICP_COIN_TX_2',
        asset: coinAsset,
      });
      jest.spyOn(internetComputerService, 'getPayoutCompletionData').mockResolvedValue([false, 0]);
      const completeSpy = jest.spyOn(order, 'complete');
      const recordFeeSpy = jest.spyOn(order, 'recordPayoutFee');

      await strategy.checkPayoutCompletionData([order]);

      expect(completeSpy).not.toHaveBeenCalled();
      expect(recordFeeSpy).not.toHaveBeenCalled();
      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
      expect(payoutOrderRepo.save).not.toHaveBeenCalled();
    });

    it('checkPayoutCompletionData(...) catches and logs errors without throwing', async () => {
      const order = createCustomPayoutOrder({ status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: 'ICP_TX_ERR' });
      jest.spyOn(internetComputerService, 'getPayoutCompletionData').mockRejectedValue(new Error('canister down'));
      const completeSpy = jest.spyOn(order, 'complete');

      await expect(strategy.checkPayoutCompletionData([order])).resolves.toBeUndefined();

      expect(completeSpy).not.toHaveBeenCalled();
      expect(payoutOrderRepo.save).not.toHaveBeenCalled();
    });
  });
});

class EvmStrategyWrapper extends EvmStrategy {
  constructor(
    payoutEvmService: PayoutEvmService,
    payoutOrderRepo: PayoutOrderRepository,
    private readonly feeAssetValue: Asset,
  ) {
    super(payoutEvmService, payoutOrderRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.ETHEREUM;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected async dispatchPayout(_order: PayoutOrder): Promise<string> {
    throw new Error('Method not implemented.');
  }

  protected getCurrentGasForTransaction(token?: Asset): Promise<number> {
    return this.getCurrentGasForTransactionPublic(token);
  }

  // overridable spy target: `getCurrentGasForTransaction` is protected and cannot be spied on
  // directly, so it delegates to this public method instead.
  getCurrentGasForTransactionPublic(_token?: Asset): Promise<number> {
    return Promise.resolve(0);
  }

  protected getFeeAsset(): Promise<Asset> {
    return Promise.resolve(this.feeAssetValue);
  }
}

class SolanaStrategyWrapper extends SolanaStrategy {
  constructor(
    solanaService: PayoutSolanaService,
    payoutOrderRepo: PayoutOrderRepository,
    private readonly feeAssetValue: Asset,
  ) {
    super(solanaService, payoutOrderRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.SOLANA;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected async dispatchPayout(_order: PayoutOrder): Promise<string> {
    throw new Error('Method not implemented.');
  }

  protected getCurrentGasForTransaction(token?: Asset): Promise<number> {
    return this.getCurrentGasForTransactionPublic(token);
  }

  getCurrentGasForTransactionPublic(_token?: Asset): Promise<number> {
    return Promise.resolve(0);
  }

  protected getFeeAsset(): Promise<Asset> {
    return Promise.resolve(this.feeAssetValue);
  }
}

class TronStrategyWrapper extends TronStrategy {
  constructor(
    tronService: PayoutTronService,
    payoutOrderRepo: PayoutOrderRepository,
    private readonly feeAssetValue: Asset,
  ) {
    super(tronService, payoutOrderRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.TRON;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected async dispatchPayout(_order: PayoutOrder): Promise<string> {
    throw new Error('Method not implemented.');
  }

  protected getCurrentGasForTransaction(token?: Asset): Promise<number> {
    return this.getCurrentGasForTransactionPublic(token);
  }

  getCurrentGasForTransactionPublic(_token?: Asset): Promise<number> {
    return Promise.resolve(0);
  }

  protected getFeeAsset(): Promise<Asset> {
    return Promise.resolve(this.feeAssetValue);
  }
}

class CardanoStrategyWrapper extends CardanoStrategy {
  constructor(
    cardanoService: PayoutCardanoService,
    payoutOrderRepo: PayoutOrderRepository,
    private readonly feeAssetValue: Asset,
  ) {
    super(cardanoService, payoutOrderRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.CARDANO;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected async dispatchPayout(_order: PayoutOrder): Promise<string> {
    throw new Error('Method not implemented.');
  }

  protected getCurrentGasForTransaction(token?: Asset): Promise<number> {
    return this.getCurrentGasForTransactionPublic(token);
  }

  getCurrentGasForTransactionPublic(_token?: Asset): Promise<number> {
    return Promise.resolve(0);
  }

  protected getFeeAsset(): Promise<Asset> {
    return Promise.resolve(this.feeAssetValue);
  }
}

class IcpStrategyWrapper extends InternetComputerStrategy {
  get blockchain(): Blockchain {
    return Blockchain.INTERNET_COMPUTER;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected async dispatchPayout(_order: PayoutOrder): Promise<string> {
    throw new Error('Method not implemented.');
  }

  protected getCurrentGasForTransaction(token?: Asset): Promise<number> {
    return this.getCurrentGasForTransactionPublic(token);
  }

  getCurrentGasForTransactionPublic(_token?: Asset): Promise<number> {
    return Promise.resolve(0);
  }

  protected getFeeAsset(): Promise<Asset> {
    throw new Error('Method not implemented.'); // never invoked: ICP uses order.asset/input asset directly
  }
}
