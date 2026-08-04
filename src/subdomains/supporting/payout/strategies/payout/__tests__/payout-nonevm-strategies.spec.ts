import { mock } from 'jest-mock-extended';
import { ConfigService } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { createCustomPayoutOrder } from '../../../entities/__mocks__/payout-order.entity.mock';
import { PayoutOrder, PayoutOrderContext, PayoutOrderStatus } from '../../../entities/payout-order.entity';
import { FeeResult } from '../../../interfaces';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutGroup } from '../../../services/base/payout-bitcoin-based.service';
import { PayoutBitcoinTestnet4Service } from '../../../services/payout-bitcoin-testnet4.service';
import { PayoutBitcoinService } from '../../../services/payout-bitcoin.service';
import { PayoutCardanoService } from '../../../services/payout-cardano.service';
import { PayoutFiroService } from '../../../services/payout-firo.service';
import { PayoutInternetComputerService } from '../../../services/payout-icp.service';
import { PayoutMoneroService } from '../../../services/payout-monero.service';
import { PayoutSolanaService } from '../../../services/payout-solana.service';
import { PayoutTronService } from '../../../services/payout-tron.service';
import { PayoutZanoService } from '../../../services/payout-zano.service';
import { BitcoinTestnet4Strategy } from '../impl/bitcoin-testnet4.strategy';
import { BitcoinStrategy } from '../impl/bitcoin.strategy';
import { PayoutStrategy } from '../impl/base/payout.strategy';
import { CardanoCoinStrategy } from '../impl/cardano-coin.strategy';
import { CardanoTokenStrategy } from '../impl/cardano-token.strategy';
import { FiroStrategy } from '../impl/firo.strategy';
import { InternetComputerCoinStrategy } from '../impl/icp-coin.strategy';
import { InternetComputerTokenStrategy } from '../impl/icp-token.strategy';
import { MoneroStrategy } from '../impl/monero.strategy';
import { SolanaCoinStrategy } from '../impl/solana-coin.strategy';
import { SolanaTokenStrategy } from '../impl/solana-token.strategy';
import { TronCoinStrategy } from '../impl/tron-coin.strategy';
import { TronTokenStrategy } from '../impl/tron-token.strategy';
import { ZanoCoinStrategy } from '../impl/zano-coin.strategy';
import { ZanoTokenStrategy } from '../impl/zano-token.strategy';

// Leaf-strategy coverage for the concrete non-EVM payout strategies. The registry spec only
// constructs these classes (hard-coding blockchain/assetType in its wrapper), so their own
// getters plus the leaf overrides (getFeeAsset, getCurrentGasForTransaction, dispatchPayout,
// estimateFee, doPayoutForContext, hasEnoughUnlockedBalance) are otherwise never executed.
// The shared base classes in impl/base/ are covered separately. Arkade/Spark/Lightning are
// already fully covered by payout-strategy-fee-completion.leaf.spec.ts and
// payout-designate-before-broadcast.strategy.spec.ts, so they are intentionally not repeated here.

const CONTEXT = PayoutOrderContext.BUY_CRYPTO;

// ---------------------------------------------------------------------------------------------
// Cardano / Solana / Tron / ICP coin & token leaves. These only add getters, getFeeAsset,
// getCurrentGasForTransaction and dispatchPayout on top of a shared base; each is exercised via
// its public entry point (getters directly, getFeeAsset via feeAsset(), getCurrentGasForTransaction
// via estimateFee(), dispatchPayout via doPayout()).
// ---------------------------------------------------------------------------------------------

interface LeafSetup {
  strategy: PayoutStrategy;
  feeAsset: Asset;
  gasAsset: Asset;
  mockFeeAsset: () => void;
  expectFeeAssetResolved: () => void;
  mockGas: (gas: number) => void;
  expectGasResolved: () => void;
  mockDispatch: (txId: string) => void;
  expectDispatched: (order: PayoutOrder) => void;
  estimate: (asset: Asset) => Promise<FeeResult>;
  doPayout: (orders: PayoutOrder[]) => Promise<void>;
  makeOrder: () => PayoutOrder;
}

interface LeafConfig {
  name: string;
  blockchain: Blockchain;
  assetType: AssetType;
  // ICP's base estimateFee echoes the passed asset; the others resolve the chain fee asset.
  estimateReturnsFeeAsset: boolean;
  setup: () => LeafSetup;
}

function repoSaveEcho(payoutOrderRepo: PayoutOrderRepository): void {
  jest.spyOn(payoutOrderRepo, 'save').mockImplementation(async (o) => o as PayoutOrder);
}

function repoUpdateAffected(payoutOrderRepo: PayoutOrderRepository): void {
  jest.spyOn(payoutOrderRepo, 'update').mockResolvedValue({ affected: 1 } as any);
}

function makeConfirmedCoinOrder(): PayoutOrder {
  return createCustomPayoutOrder({
    status: PayoutOrderStatus.PREPARATION_CONFIRMED,
    payoutTxId: null,
    destinationAddress: 'DEST_ADDR',
    amount: 5,
  });
}

function makeConfirmedTokenOrder(tokenAsset: Asset): PayoutOrder {
  return createCustomPayoutOrder({
    status: PayoutOrderStatus.PREPARATION_CONFIRMED,
    payoutTxId: null,
    destinationAddress: 'DEST_ADDR',
    amount: 5,
    asset: tokenAsset,
  });
}

function runNonEvmLeafSuite(config: LeafConfig): void {
  describe(config.name, () => {
    it(`exposes the ${config.blockchain} blockchain and the ${config.assetType} asset type`, () => {
      const s = config.setup();

      expect(s.strategy.blockchain).toBe(config.blockchain);
      expect(s.strategy.assetType).toBe(config.assetType);
    });

    it('feeAsset() delegates to the AssetService fee-asset getter', async () => {
      const s = config.setup();
      s.mockFeeAsset();

      await expect(s.strategy.feeAsset()).resolves.toBe(s.feeAsset);

      s.expectFeeAssetResolved();
    });

    it('estimateFee(...) delegates the gas lookup to the chain service and returns the fee', async () => {
      const s = config.setup();
      s.mockFeeAsset();
      s.mockGas(0.123);

      const result = await s.estimate(s.gasAsset);

      s.expectGasResolved();
      expect(result.amount).toBe(0.123);
      expect(result.asset).toBe(config.estimateReturnsFeeAsset ? s.feeAsset : s.gasAsset);
    });

    it('doPayout(...) broadcasts through the chain service and reaches PAYOUT_PENDING', async () => {
      const s = config.setup();
      s.mockDispatch('TX_LEAF');
      const order = s.makeOrder();

      await s.doPayout([order]);

      s.expectDispatched(order);
      expect(order.status).toBe(PayoutOrderStatus.PAYOUT_PENDING);
      expect(order.payoutTxId).toBe('TX_LEAF');
    });
  });
}

describe('Payout non-EVM leaf strategies', () => {
  beforeAll(() => {
    new ConfigService(); // sets the module-level Config (Config.blockchain.firo used by FiroStrategy#estimateFee)
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ------------------------------- Cardano -------------------------------

  runNonEvmLeafSuite({
    name: 'CardanoCoinStrategy',
    blockchain: Blockchain.CARDANO,
    assetType: AssetType.COIN,
    estimateReturnsFeeAsset: true,
    setup: () => {
      const cardanoService = mock<PayoutCardanoService>();
      const assetService = mock<AssetService>();
      const payoutOrderRepo = mock<PayoutOrderRepository>();
      const feeAsset = createCustomAsset({ name: 'ADA' });
      const gasAsset = createCustomAsset({ id: 42, type: AssetType.COIN });
      repoUpdateAffected(payoutOrderRepo);
      repoSaveEcho(payoutOrderRepo);
      const strategy = new CardanoCoinStrategy(cardanoService, assetService, payoutOrderRepo);

      return {
        strategy,
        feeAsset,
        gasAsset,
        mockFeeAsset: () => jest.spyOn(assetService, 'getCardanoCoin').mockResolvedValue(feeAsset),
        expectFeeAssetResolved: () => expect(assetService.getCardanoCoin).toHaveBeenCalledTimes(1),
        mockGas: (g) => jest.spyOn(cardanoService, 'getCurrentGasForCoinTransaction').mockResolvedValue(g),
        expectGasResolved: () => expect(cardanoService.getCurrentGasForCoinTransaction).toHaveBeenCalledTimes(1),
        mockDispatch: (tx) => jest.spyOn(cardanoService, 'sendNativeCoin').mockResolvedValue(tx),
        expectDispatched: (order) =>
          expect(cardanoService.sendNativeCoin).toHaveBeenCalledWith(order.destinationAddress, order.amount),
        estimate: (asset) => strategy.estimateFee(asset),
        doPayout: (orders) => strategy.doPayout(orders),
        makeOrder: makeConfirmedCoinOrder,
      };
    },
  });

  runNonEvmLeafSuite({
    name: 'CardanoTokenStrategy',
    blockchain: Blockchain.CARDANO,
    assetType: AssetType.TOKEN,
    estimateReturnsFeeAsset: true,
    setup: () => {
      const cardanoService = mock<PayoutCardanoService>();
      const assetService = mock<AssetService>();
      const payoutOrderRepo = mock<PayoutOrderRepository>();
      const feeAsset = createCustomAsset({ name: 'ADA' });
      const gasAsset = createCustomAsset({ id: 43, type: AssetType.TOKEN });
      repoUpdateAffected(payoutOrderRepo);
      repoSaveEcho(payoutOrderRepo);
      const strategy = new CardanoTokenStrategy(cardanoService, assetService, payoutOrderRepo);

      return {
        strategy,
        feeAsset,
        gasAsset,
        mockFeeAsset: () => jest.spyOn(assetService, 'getCardanoCoin').mockResolvedValue(feeAsset),
        expectFeeAssetResolved: () => expect(assetService.getCardanoCoin).toHaveBeenCalledTimes(1),
        mockGas: (g) => jest.spyOn(cardanoService, 'getCurrentGasForTokenTransaction').mockResolvedValue(g),
        expectGasResolved: () => expect(cardanoService.getCurrentGasForTokenTransaction).toHaveBeenCalledWith(gasAsset),
        mockDispatch: (tx) => jest.spyOn(cardanoService, 'sendToken').mockResolvedValue(tx),
        expectDispatched: (order) =>
          expect(cardanoService.sendToken).toHaveBeenCalledWith(order.destinationAddress, order.asset, order.amount),
        estimate: (asset) => strategy.estimateFee(asset),
        doPayout: (orders) => strategy.doPayout(orders),
        makeOrder: () => makeConfirmedTokenOrder(createCustomAsset({ id: 7, type: AssetType.TOKEN })),
      };
    },
  });

  // ------------------------------- Solana -------------------------------

  runNonEvmLeafSuite({
    name: 'SolanaCoinStrategy',
    blockchain: Blockchain.SOLANA,
    assetType: AssetType.COIN,
    estimateReturnsFeeAsset: true,
    setup: () => {
      const solanaService = mock<PayoutSolanaService>();
      const assetService = mock<AssetService>();
      const payoutOrderRepo = mock<PayoutOrderRepository>();
      const feeAsset = createCustomAsset({ name: 'SOL' });
      const gasAsset = createCustomAsset({ id: 42, type: AssetType.COIN });
      repoUpdateAffected(payoutOrderRepo);
      repoSaveEcho(payoutOrderRepo);
      const strategy = new SolanaCoinStrategy(solanaService, assetService, payoutOrderRepo);

      return {
        strategy,
        feeAsset,
        gasAsset,
        mockFeeAsset: () => jest.spyOn(assetService, 'getSolanaCoin').mockResolvedValue(feeAsset),
        expectFeeAssetResolved: () => expect(assetService.getSolanaCoin).toHaveBeenCalledTimes(1),
        mockGas: (g) => jest.spyOn(solanaService, 'getCurrentGasForCoinTransaction').mockResolvedValue(g),
        expectGasResolved: () => expect(solanaService.getCurrentGasForCoinTransaction).toHaveBeenCalledTimes(1),
        mockDispatch: (tx) => jest.spyOn(solanaService, 'sendNativeCoin').mockResolvedValue(tx),
        expectDispatched: (order) =>
          expect(solanaService.sendNativeCoin).toHaveBeenCalledWith(order.destinationAddress, order.amount),
        estimate: (asset) => strategy.estimateFee(asset),
        doPayout: (orders) => strategy.doPayout(orders),
        makeOrder: makeConfirmedCoinOrder,
      };
    },
  });

  runNonEvmLeafSuite({
    name: 'SolanaTokenStrategy',
    blockchain: Blockchain.SOLANA,
    assetType: AssetType.TOKEN,
    estimateReturnsFeeAsset: true,
    setup: () => {
      const solanaService = mock<PayoutSolanaService>();
      const assetService = mock<AssetService>();
      const payoutOrderRepo = mock<PayoutOrderRepository>();
      const feeAsset = createCustomAsset({ name: 'SOL' });
      const gasAsset = createCustomAsset({ id: 43, type: AssetType.TOKEN });
      repoUpdateAffected(payoutOrderRepo);
      repoSaveEcho(payoutOrderRepo);
      const strategy = new SolanaTokenStrategy(solanaService, assetService, payoutOrderRepo);

      return {
        strategy,
        feeAsset,
        gasAsset,
        mockFeeAsset: () => jest.spyOn(assetService, 'getSolanaCoin').mockResolvedValue(feeAsset),
        expectFeeAssetResolved: () => expect(assetService.getSolanaCoin).toHaveBeenCalledTimes(1),
        mockGas: (g) => jest.spyOn(solanaService, 'getCurrentGasForTokenTransaction').mockResolvedValue(g),
        expectGasResolved: () => expect(solanaService.getCurrentGasForTokenTransaction).toHaveBeenCalledWith(gasAsset),
        mockDispatch: (tx) => jest.spyOn(solanaService, 'sendToken').mockResolvedValue(tx),
        expectDispatched: (order) =>
          expect(solanaService.sendToken).toHaveBeenCalledWith(order.destinationAddress, order.asset, order.amount),
        estimate: (asset) => strategy.estimateFee(asset),
        doPayout: (orders) => strategy.doPayout(orders),
        makeOrder: () => makeConfirmedTokenOrder(createCustomAsset({ id: 7, type: AssetType.TOKEN })),
      };
    },
  });

  // ------------------------------- Tron -------------------------------

  runNonEvmLeafSuite({
    name: 'TronCoinStrategy',
    blockchain: Blockchain.TRON,
    assetType: AssetType.COIN,
    estimateReturnsFeeAsset: true,
    setup: () => {
      const tronService = mock<PayoutTronService>();
      const assetService = mock<AssetService>();
      const payoutOrderRepo = mock<PayoutOrderRepository>();
      const feeAsset = createCustomAsset({ name: 'TRX' });
      const gasAsset = createCustomAsset({ id: 42, type: AssetType.COIN });
      repoUpdateAffected(payoutOrderRepo);
      repoSaveEcho(payoutOrderRepo);
      const strategy = new TronCoinStrategy(tronService, assetService, payoutOrderRepo);

      return {
        strategy,
        feeAsset,
        gasAsset,
        mockFeeAsset: () => jest.spyOn(assetService, 'getTronCoin').mockResolvedValue(feeAsset),
        expectFeeAssetResolved: () => expect(assetService.getTronCoin).toHaveBeenCalledTimes(1),
        mockGas: (g) => jest.spyOn(tronService, 'getCurrentGasForCoinTransaction').mockResolvedValue(g),
        expectGasResolved: () => expect(tronService.getCurrentGasForCoinTransaction).toHaveBeenCalledTimes(1),
        mockDispatch: (tx) => jest.spyOn(tronService, 'sendNativeCoin').mockResolvedValue(tx),
        expectDispatched: (order) =>
          expect(tronService.sendNativeCoin).toHaveBeenCalledWith(order.destinationAddress, order.amount),
        estimate: (asset) => strategy.estimateFee(asset),
        doPayout: (orders) => strategy.doPayout(orders),
        makeOrder: makeConfirmedCoinOrder,
      };
    },
  });

  runNonEvmLeafSuite({
    name: 'TronTokenStrategy',
    blockchain: Blockchain.TRON,
    assetType: AssetType.TOKEN,
    estimateReturnsFeeAsset: true,
    setup: () => {
      const tronService = mock<PayoutTronService>();
      const assetService = mock<AssetService>();
      const payoutOrderRepo = mock<PayoutOrderRepository>();
      const feeAsset = createCustomAsset({ name: 'TRX' });
      const gasAsset = createCustomAsset({ id: 43, type: AssetType.TOKEN });
      repoUpdateAffected(payoutOrderRepo);
      repoSaveEcho(payoutOrderRepo);
      const strategy = new TronTokenStrategy(tronService, assetService, payoutOrderRepo);

      return {
        strategy,
        feeAsset,
        gasAsset,
        mockFeeAsset: () => jest.spyOn(assetService, 'getTronCoin').mockResolvedValue(feeAsset),
        expectFeeAssetResolved: () => expect(assetService.getTronCoin).toHaveBeenCalledTimes(1),
        mockGas: (g) => jest.spyOn(tronService, 'getCurrentGasForTokenTransaction').mockResolvedValue(g),
        expectGasResolved: () => expect(tronService.getCurrentGasForTokenTransaction).toHaveBeenCalledWith(gasAsset),
        mockDispatch: (tx) => jest.spyOn(tronService, 'sendToken').mockResolvedValue(tx),
        expectDispatched: (order) =>
          expect(tronService.sendToken).toHaveBeenCalledWith(order.destinationAddress, order.asset, order.amount),
        estimate: (asset) => strategy.estimateFee(asset),
        doPayout: (orders) => strategy.doPayout(orders),
        makeOrder: () => makeConfirmedTokenOrder(createCustomAsset({ id: 7, type: AssetType.TOKEN })),
      };
    },
  });

  // ------------------------------- ICP -------------------------------

  runNonEvmLeafSuite({
    name: 'InternetComputerCoinStrategy',
    blockchain: Blockchain.INTERNET_COMPUTER,
    assetType: AssetType.COIN,
    estimateReturnsFeeAsset: false,
    setup: () => {
      const icpService = mock<PayoutInternetComputerService>();
      const assetService = mock<AssetService>();
      const payoutOrderRepo = mock<PayoutOrderRepository>();
      const feeAsset = createCustomAsset({ name: 'ICP' });
      const gasAsset = createCustomAsset({ id: 42, type: AssetType.COIN });
      repoUpdateAffected(payoutOrderRepo);
      repoSaveEcho(payoutOrderRepo);
      const strategy = new InternetComputerCoinStrategy(icpService, assetService, payoutOrderRepo);

      return {
        strategy,
        feeAsset,
        gasAsset,
        mockFeeAsset: () => jest.spyOn(assetService, 'getInternetComputerCoin').mockResolvedValue(feeAsset),
        expectFeeAssetResolved: () => expect(assetService.getInternetComputerCoin).toHaveBeenCalledTimes(1),
        mockGas: (g) => jest.spyOn(icpService, 'getCurrentGasForCoinTransaction').mockResolvedValue(g),
        expectGasResolved: () => expect(icpService.getCurrentGasForCoinTransaction).toHaveBeenCalledTimes(1),
        mockDispatch: (tx) => jest.spyOn(icpService, 'sendNativeCoin').mockResolvedValue(tx),
        expectDispatched: (order) =>
          expect(icpService.sendNativeCoin).toHaveBeenCalledWith(order.destinationAddress, order.amount),
        estimate: (asset) => strategy.estimateFee(asset),
        doPayout: (orders) => strategy.doPayout(orders),
        makeOrder: makeConfirmedCoinOrder,
      };
    },
  });

  runNonEvmLeafSuite({
    name: 'InternetComputerTokenStrategy',
    blockchain: Blockchain.INTERNET_COMPUTER,
    assetType: AssetType.TOKEN,
    estimateReturnsFeeAsset: false,
    setup: () => {
      const icpService = mock<PayoutInternetComputerService>();
      const assetService = mock<AssetService>();
      const payoutOrderRepo = mock<PayoutOrderRepository>();
      const feeAsset = createCustomAsset({ name: 'ICP' });
      const gasAsset = createCustomAsset({ id: 43, type: AssetType.TOKEN });
      repoUpdateAffected(payoutOrderRepo);
      repoSaveEcho(payoutOrderRepo);
      const strategy = new InternetComputerTokenStrategy(icpService, assetService, payoutOrderRepo);

      return {
        strategy,
        feeAsset,
        gasAsset,
        mockFeeAsset: () => jest.spyOn(assetService, 'getInternetComputerCoin').mockResolvedValue(feeAsset),
        expectFeeAssetResolved: () => expect(assetService.getInternetComputerCoin).toHaveBeenCalledTimes(1),
        mockGas: (g) => jest.spyOn(icpService, 'getCurrentGasForTokenTransaction').mockResolvedValue(g),
        expectGasResolved: () => expect(icpService.getCurrentGasForTokenTransaction).toHaveBeenCalledWith(gasAsset),
        mockDispatch: (tx) => jest.spyOn(icpService, 'sendToken').mockResolvedValue(tx),
        expectDispatched: (order) =>
          expect(icpService.sendToken).toHaveBeenCalledWith(order.destinationAddress, order.asset, order.amount),
        estimate: (asset) => strategy.estimateFee(asset),
        doPayout: (orders) => strategy.doPayout(orders),
        makeOrder: () => makeConfirmedTokenOrder(createCustomAsset({ id: 7, type: AssetType.TOKEN })),
      };
    },
  });

  // ------------------------------- Zano -------------------------------

  describe('ZanoCoinStrategy', () => {
    let notificationService: NotificationService;
    let payoutOrderRepo: PayoutOrderRepository;
    let payoutZanoService: PayoutZanoService;
    let assetService: AssetService;
    let strategy: ZanoCoinStrategy;

    beforeEach(() => {
      notificationService = mock<NotificationService>();
      payoutOrderRepo = mock<PayoutOrderRepository>();
      payoutZanoService = mock<PayoutZanoService>();
      assetService = mock<AssetService>();
      strategy = new ZanoCoinStrategy(notificationService, payoutOrderRepo, payoutZanoService, assetService);
    });

    it('exposes the Zano blockchain and a COIN asset type', () => {
      expect(strategy.blockchain).toBe(Blockchain.ZANO);
      expect(strategy.assetType).toBe(AssetType.COIN);
    });

    it('hasEnoughUnlockedBalance(...) returns true when the unlocked coin balance covers the total', async () => {
      jest.spyOn(payoutZanoService, 'getUnlockedCoinBalance').mockResolvedValue(10);
      const orders = [createCustomPayoutOrder({ amount: 1 }), createCustomPayoutOrder({ amount: 2 })];

      await expect(strategy.hasEnoughUnlockedBalance(orders)).resolves.toBe(true);

      expect(payoutZanoService.getUnlockedCoinBalance).toHaveBeenCalledTimes(1);
    });

    it('hasEnoughUnlockedBalance(...) returns false when the unlocked coin balance is short', async () => {
      jest.spyOn(payoutZanoService, 'getUnlockedCoinBalance').mockResolvedValue(2);
      const orders = [createCustomPayoutOrder({ amount: 1 }), createCustomPayoutOrder({ amount: 2 })];

      await expect(strategy.hasEnoughUnlockedBalance(orders)).resolves.toBe(false);
    });

    it('dispatchPayout(...) delegates the group to PayoutZanoService#sendCoins(...)', async () => {
      jest.spyOn(payoutZanoService, 'sendCoins').mockResolvedValue('ZANO_COIN_TX');
      const payout: PayoutGroup = [{ addressTo: 'ADDR', amount: 1 }];

      await expect(strategy.dispatchPayout(CONTEXT, payout)).resolves.toBe('ZANO_COIN_TX');

      expect(payoutZanoService.sendCoins).toHaveBeenCalledWith(payout);
    });
  });

  describe('ZanoTokenStrategy', () => {
    let notificationService: NotificationService;
    let payoutOrderRepo: PayoutOrderRepository;
    let payoutZanoService: PayoutZanoService;
    let assetService: AssetService;
    let strategy: ZanoTokenStrategy;

    beforeEach(() => {
      notificationService = mock<NotificationService>();
      payoutOrderRepo = mock<PayoutOrderRepository>();
      payoutZanoService = mock<PayoutZanoService>();
      assetService = mock<AssetService>();
      strategy = new ZanoTokenStrategy(notificationService, payoutOrderRepo, payoutZanoService, assetService);
    });

    it('exposes the Zano blockchain and a TOKEN asset type', () => {
      expect(strategy.blockchain).toBe(Blockchain.ZANO);
      expect(strategy.assetType).toBe(AssetType.TOKEN);
    });

    it('hasEnoughUnlockedBalance(...) checks the unlocked token balance for the order asset', async () => {
      const tokenAsset = createCustomAsset({ id: 7, type: AssetType.TOKEN });
      jest.spyOn(payoutZanoService, 'getUnlockedTokenBalance').mockResolvedValue(10);
      const orders = [
        createCustomPayoutOrder({ amount: 1, asset: tokenAsset }),
        createCustomPayoutOrder({ amount: 2, asset: tokenAsset }),
      ];

      await expect(strategy.hasEnoughUnlockedBalance(orders)).resolves.toBe(true);

      expect(payoutZanoService.getUnlockedTokenBalance).toHaveBeenCalledWith(tokenAsset);
    });

    it('hasEnoughUnlockedBalance(...) returns false when the unlocked token balance is short', async () => {
      const tokenAsset = createCustomAsset({ id: 7, type: AssetType.TOKEN });
      jest.spyOn(payoutZanoService, 'getUnlockedTokenBalance').mockResolvedValue(2);
      const orders = [
        createCustomPayoutOrder({ amount: 1, asset: tokenAsset }),
        createCustomPayoutOrder({ amount: 2, asset: tokenAsset }),
      ];

      await expect(strategy.hasEnoughUnlockedBalance(orders)).resolves.toBe(false);
    });

    it('dispatchPayout(...) delegates the group and token to PayoutZanoService#sendTokens(...)', async () => {
      const tokenAsset = createCustomAsset({ id: 7, type: AssetType.TOKEN });
      jest.spyOn(payoutZanoService, 'sendTokens').mockResolvedValue('ZANO_TOKEN_TX');
      const payout: PayoutGroup = [{ addressTo: 'ADDR', amount: 1 }];

      await expect(strategy.dispatchPayout(CONTEXT, payout, tokenAsset)).resolves.toBe('ZANO_TOKEN_TX');

      expect(payoutZanoService.sendTokens).toHaveBeenCalledWith(payout, tokenAsset);
    });
  });

  // ------------------------------- Bitcoin -------------------------------

  describe('BitcoinStrategy', () => {
    let notificationService: NotificationService;
    let bitcoinService: PayoutBitcoinService;
    let payoutOrderRepo: PayoutOrderRepository;
    let assetService: AssetService;
    let strategy: BitcoinStrategyWrapper;

    beforeEach(() => {
      notificationService = mock<NotificationService>();
      bitcoinService = mock<PayoutBitcoinService>();
      payoutOrderRepo = mock<PayoutOrderRepository>();
      assetService = mock<AssetService>();
      strategy = new BitcoinStrategyWrapper(notificationService, bitcoinService, payoutOrderRepo, assetService);
    });

    it('exposes the Bitcoin blockchain and an undefined asset type', () => {
      expect(strategy.blockchain).toBe(Blockchain.BITCOIN);
      expect(strategy.assetType).toBeUndefined();
    });

    it('estimateFee() derives the BTC fee from the current fee rate and the average tx size', async () => {
      const feeAsset = createCustomAsset({ name: 'BTC' });
      jest.spyOn(bitcoinService, 'getCurrentFeeRate').mockResolvedValue(100);
      jest.spyOn(assetService, 'getBtcCoin').mockResolvedValue(feeAsset);

      const result = await strategy.estimateFee();

      expect(bitcoinService.getCurrentFeeRate).toHaveBeenCalledTimes(1);
      expect(result.asset).toBe(feeAsset);
      expect(result.amount).toBeCloseTo(0.00014, 8); // 140 vBytes * 100 / 1e8
    });

    it('feeAsset() delegates to AssetService#getBtcCoin()', async () => {
      const feeAsset = createCustomAsset({ name: 'BTC' });
      jest.spyOn(assetService, 'getBtcCoin').mockResolvedValue(feeAsset);

      await expect(strategy.feeAsset()).resolves.toBe(feeAsset);

      expect(assetService.getBtcCoin).toHaveBeenCalledTimes(1);
    });

    it('dispatchPayout(...) delegates to PayoutBitcoinService#sendUtxoToMany(...)', async () => {
      jest.spyOn(bitcoinService, 'sendUtxoToMany').mockResolvedValue('BTC_TX');
      const payout: PayoutGroup = [{ addressTo: 'ADDR', amount: 1 }];

      await expect(strategy.dispatchPayoutWrapper(CONTEXT, payout)).resolves.toBe('BTC_TX');

      expect(bitcoinService.sendUtxoToMany).toHaveBeenCalledWith(CONTEXT, payout);
    });

    it('doPayoutForContext(...) skips empty groups and sends the non-empty ones', async () => {
      const order = createCustomPayoutOrder({});
      jest.spyOn(strategy as any, 'createPayoutGroups').mockReturnValue([[], [order]]);
      const sendSpy = jest.spyOn(strategy as any, 'send').mockResolvedValue(undefined);

      await strategy.doPayoutForContextWrapper(CONTEXT, [order]);

      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(CONTEXT, [order]);
    });

    it('doPayoutForContext(...) swallows a failing group without propagating the error', async () => {
      const order = createCustomPayoutOrder({});
      jest.spyOn(strategy as any, 'createPayoutGroups').mockReturnValue([[order]]);
      const sendSpy = jest.spyOn(strategy as any, 'send').mockRejectedValue(new Error('btc send failed'));

      await expect(strategy.doPayoutForContextWrapper(CONTEXT, [order])).resolves.toBeUndefined();

      expect(sendSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ------------------------------- Bitcoin Testnet4 -------------------------------

  describe('BitcoinTestnet4Strategy', () => {
    let notificationService: NotificationService;
    let bitcoinTestnet4Service: PayoutBitcoinTestnet4Service;
    let payoutOrderRepo: PayoutOrderRepository;
    let assetService: AssetService;
    let strategy: BitcoinTestnet4StrategyWrapper;

    beforeEach(() => {
      notificationService = mock<NotificationService>();
      bitcoinTestnet4Service = mock<PayoutBitcoinTestnet4Service>();
      payoutOrderRepo = mock<PayoutOrderRepository>();
      assetService = mock<AssetService>();
      strategy = new BitcoinTestnet4StrategyWrapper(
        notificationService,
        bitcoinTestnet4Service,
        payoutOrderRepo,
        assetService,
      );
    });

    it('exposes the Bitcoin Testnet4 blockchain and an undefined asset type', () => {
      expect(strategy.blockchain).toBe(Blockchain.BITCOIN_TESTNET4);
      expect(strategy.assetType).toBeUndefined();
    });

    it('estimateFee() derives the fee from the current fee rate and the average tx size', async () => {
      const feeAsset = createCustomAsset({ name: 'tBTC' });
      jest.spyOn(bitcoinTestnet4Service, 'getCurrentFeeRate').mockResolvedValue(100);
      jest.spyOn(assetService, 'getBitcoinTestnet4Coin').mockResolvedValue(feeAsset);

      const result = await strategy.estimateFee();

      expect(bitcoinTestnet4Service.getCurrentFeeRate).toHaveBeenCalledTimes(1);
      expect(result.asset).toBe(feeAsset);
      expect(result.amount).toBeCloseTo(0.00014, 8); // 140 vBytes * 100 / 1e8
    });

    it('feeAsset() delegates to AssetService#getBitcoinTestnet4Coin()', async () => {
      const feeAsset = createCustomAsset({ name: 'tBTC' });
      jest.spyOn(assetService, 'getBitcoinTestnet4Coin').mockResolvedValue(feeAsset);

      await expect(strategy.feeAsset()).resolves.toBe(feeAsset);

      expect(assetService.getBitcoinTestnet4Coin).toHaveBeenCalledTimes(1);
    });

    it('dispatchPayout(...) delegates to PayoutBitcoinTestnet4Service#sendUtxoToMany(...)', async () => {
      jest.spyOn(bitcoinTestnet4Service, 'sendUtxoToMany').mockResolvedValue('tBTC_TX');
      const payout: PayoutGroup = [{ addressTo: 'ADDR', amount: 1 }];

      await expect(strategy.dispatchPayoutWrapper(CONTEXT, payout)).resolves.toBe('tBTC_TX');

      expect(bitcoinTestnet4Service.sendUtxoToMany).toHaveBeenCalledWith(CONTEXT, payout);
    });

    it('doPayoutForContext(...) skips empty groups and sends the non-empty ones', async () => {
      const order = createCustomPayoutOrder({});
      jest.spyOn(strategy as any, 'createPayoutGroups').mockReturnValue([[], [order]]);
      const sendSpy = jest.spyOn(strategy as any, 'send').mockResolvedValue(undefined);

      await strategy.doPayoutForContextWrapper(CONTEXT, [order]);

      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(CONTEXT, [order]);
    });

    it('doPayoutForContext(...) swallows a failing group without propagating the error', async () => {
      const order = createCustomPayoutOrder({});
      jest.spyOn(strategy as any, 'createPayoutGroups').mockReturnValue([[order]]);
      const sendSpy = jest.spyOn(strategy as any, 'send').mockRejectedValue(new Error('tbtc send failed'));

      await expect(strategy.doPayoutForContextWrapper(CONTEXT, [order])).resolves.toBeUndefined();

      expect(sendSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ------------------------------- Monero -------------------------------

  describe('MoneroStrategy', () => {
    let notificationService: NotificationService;
    let payoutMoneroService: PayoutMoneroService;
    let payoutOrderRepo: PayoutOrderRepository;
    let assetService: AssetService;
    let strategy: MoneroStrategyWrapper;

    beforeEach(() => {
      notificationService = mock<NotificationService>();
      payoutMoneroService = mock<PayoutMoneroService>();
      payoutOrderRepo = mock<PayoutOrderRepository>();
      assetService = mock<AssetService>();
      strategy = new MoneroStrategyWrapper(notificationService, payoutMoneroService, payoutOrderRepo, assetService);
    });

    it('exposes the Monero blockchain and an undefined asset type', () => {
      expect(strategy.blockchain).toBe(Blockchain.MONERO);
      expect(strategy.assetType).toBeUndefined();
    });

    it('estimateFee() derives the XMR fee from the estimated fee rate and the average tx size', async () => {
      const feeAsset = createCustomAsset({ name: 'XMR' });
      jest.spyOn(payoutMoneroService, 'getEstimatedFee').mockResolvedValue(2);
      jest.spyOn(assetService, 'getMoneroCoin').mockResolvedValue(feeAsset);

      const result = await strategy.estimateFee();

      expect(payoutMoneroService.getEstimatedFee).toHaveBeenCalledTimes(1);
      expect(result.asset).toBe(feeAsset);
      expect(result.amount).toBe(3200); // 1600 Bytes * 2
    });

    it('getFeeAsset() delegates to AssetService#getMoneroCoin()', async () => {
      const feeAsset = createCustomAsset({ name: 'XMR' });
      jest.spyOn(assetService, 'getMoneroCoin').mockResolvedValue(feeAsset);

      await expect(strategy.feeAsset()).resolves.toBe(feeAsset);

      expect(assetService.getMoneroCoin).toHaveBeenCalledTimes(1);
    });

    // Monero has no atomic dispatch by design (#4673): `transfer` builds, signs and relays in one call
    // and its -38 cannot be attributed to a phase. The leaf must fail loudly rather than quietly offer
    // the atomic path back, so pin the trap — see broadcastPayout in payout-monero-relay-split.spec.ts.
    it('dispatchPayout(...) refuses the atomic path', () => {
      expect(() => strategy.dispatchPayoutWrapper()).toThrow('Monero payouts are broadcast via broadcastPayout');
    });

    it('doPayoutForContext(...) splices groups up to the size cap and pays out until orders are drained', async () => {
      const orders = Array.from({ length: 16 }, (_, i) => createCustomPayoutOrder({ id: i + 1, amount: 1 }));
      jest.spyOn(payoutMoneroService, 'getUnlockedBalance').mockResolvedValue(100);
      const sendSpy = jest.spyOn(strategy as any, 'send').mockResolvedValue(undefined);

      await strategy.doPayoutForContextWrapper(CONTEXT, orders);

      expect(sendSpy).toHaveBeenCalledTimes(2);
      expect((sendSpy.mock.calls[0][1] as PayoutOrder[]).length).toBe(15); // maxSize cap
      expect((sendSpy.mock.calls[1][1] as PayoutOrder[]).length).toBe(1); // remaining order
    });

    it('doPayoutForContext(...) stops when the next order exceeds the unlocked balance', async () => {
      const order = createCustomPayoutOrder({ amount: 5 });
      jest.spyOn(payoutMoneroService, 'getUnlockedBalance').mockResolvedValue(3);
      const sendSpy = jest.spyOn(strategy as any, 'send').mockResolvedValue(undefined);

      await strategy.doPayoutForContextWrapper(CONTEXT, [order]);

      expect(sendSpy).not.toHaveBeenCalled();
      expect(payoutMoneroService.getUnlockedBalance).toHaveBeenCalledTimes(1);
    });

    it('doPayoutForContext(...) stops immediately when there is no unlocked balance', async () => {
      const order = createCustomPayoutOrder({ amount: 1 });
      jest.spyOn(payoutMoneroService, 'getUnlockedBalance').mockResolvedValue(0);
      const sendSpy = jest.spyOn(strategy as any, 'send').mockResolvedValue(undefined);

      await strategy.doPayoutForContextWrapper(CONTEXT, [order]);

      expect(sendSpy).not.toHaveBeenCalled();
      expect(payoutMoneroService.getUnlockedBalance).toHaveBeenCalledTimes(1);
    });

    it('doPayoutForContext(...) breaks out of the loop when a send throws', async () => {
      const order = createCustomPayoutOrder({ amount: 1 });
      jest.spyOn(payoutMoneroService, 'getUnlockedBalance').mockResolvedValue(100);
      const sendSpy = jest.spyOn(strategy as any, 'send').mockRejectedValue(new Error('xmr send failed'));

      await expect(strategy.doPayoutForContextWrapper(CONTEXT, [order])).resolves.toBeUndefined();

      expect(sendSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ------------------------------- Firo -------------------------------

  describe('FiroStrategy', () => {
    let notificationService: NotificationService;
    let firoService: PayoutFiroService;
    let payoutOrderRepo: PayoutOrderRepository;
    let assetService: AssetService;
    let strategy: FiroStrategyWrapper;

    beforeEach(() => {
      notificationService = mock<NotificationService>();
      firoService = mock<PayoutFiroService>();
      payoutOrderRepo = mock<PayoutOrderRepository>();
      assetService = mock<AssetService>();
      strategy = new FiroStrategyWrapper(notificationService, firoService, payoutOrderRepo, assetService);
    });

    it('exposes the Firo blockchain and an undefined asset type', () => {
      expect(strategy.blockchain).toBe(Blockchain.FIRO);
      expect(strategy.assetType).toBeUndefined();
    });

    it('estimateFee(...) uses the transparent tx size when no Spark address is given', async () => {
      const feeAsset = createCustomAsset({ name: 'FIRO' });
      const isSparkSpy = jest.spyOn(CryptoService, 'isFiroSparkAddress');
      jest.spyOn(firoService, 'getCurrentFeeRate').mockResolvedValue(100);
      jest.spyOn(assetService, 'getFiroCoin').mockResolvedValue(feeAsset);

      const result = await strategy.estimateFee(feeAsset);

      expect(isSparkSpy).not.toHaveBeenCalled(); // short-circuited by the missing address
      expect(result.asset).toBe(feeAsset);
      expect(result.amount).toBeCloseTo(0.000225, 8); // 225 bytes * 100 / 1e8
    });

    it('estimateFee(...) uses the Spark mint tx size for a Spark address', async () => {
      const feeAsset = createCustomAsset({ name: 'FIRO' });
      jest.spyOn(CryptoService, 'isFiroSparkAddress').mockReturnValue(true);
      jest.spyOn(firoService, 'getCurrentFeeRate').mockResolvedValue(100);
      jest.spyOn(assetService, 'getFiroCoin').mockResolvedValue(feeAsset);

      const result = await strategy.estimateFee(feeAsset, 'SPARK_ADDR');

      expect(CryptoService.isFiroSparkAddress).toHaveBeenCalledWith('SPARK_ADDR');
      expect(result.asset).toBe(feeAsset);
      expect(result.amount).toBeCloseTo(0.00048, 8); // 480 bytes * 100 / 1e8
    });

    it('getFeeAsset() delegates to AssetService#getFiroCoin()', async () => {
      const feeAsset = createCustomAsset({ name: 'FIRO' });
      jest.spyOn(assetService, 'getFiroCoin').mockResolvedValue(feeAsset);

      await expect(strategy.feeAsset()).resolves.toBe(feeAsset);

      expect(assetService.getFiroCoin).toHaveBeenCalledTimes(1);
    });

    it('dispatchPayout(...) sends a transparent group via sendUtxoToMany(...)', async () => {
      jest.spyOn(CryptoService, 'isFiroSparkAddress').mockReturnValue(false);
      jest.spyOn(firoService, 'sendUtxoToMany').mockResolvedValue('FIRO_TX');
      const payout: PayoutGroup = [{ addressTo: 'T1', amount: 1 }];

      await expect(strategy.dispatchPayoutWrapper(CONTEXT, payout)).resolves.toBe('FIRO_TX');

      expect(firoService.sendUtxoToMany).toHaveBeenCalledWith(CONTEXT, payout);
      expect(firoService.mintSpark).not.toHaveBeenCalled();
    });

    it('dispatchPayout(...) mints an all-Spark group via mintSpark(...)', async () => {
      jest.spyOn(CryptoService, 'isFiroSparkAddress').mockReturnValue(true);
      jest.spyOn(firoService, 'mintSpark').mockResolvedValue('FIRO_MINT_TX');
      const payout: PayoutGroup = [
        { addressTo: 'S1', amount: 1 },
        { addressTo: 'S2', amount: 2 },
      ];

      await expect(strategy.dispatchPayoutWrapper(CONTEXT, payout)).resolves.toBe('FIRO_MINT_TX');

      expect(firoService.mintSpark).toHaveBeenCalledWith(payout);
      expect(firoService.sendUtxoToMany).not.toHaveBeenCalled();
    });

    it('dispatchPayout(...) rejects a mixed Spark/transparent group', () => {
      jest.spyOn(CryptoService, 'isFiroSparkAddress').mockImplementation((addr) => addr === 'S1');
      const payout: PayoutGroup = [
        { addressTo: 'S1', amount: 1 },
        { addressTo: 'T1', amount: 2 },
      ];

      // dispatchPayout is a non-async method that throws synchronously on a mixed group (firo.strategy.ts:92),
      // so it must be asserted as a synchronous throw rather than a rejected promise.
      expect(() => strategy.dispatchPayoutWrapper(CONTEXT, payout)).toThrow(
        'Mixed Spark/transparent payout group detected',
      );

      expect(firoService.mintSpark).not.toHaveBeenCalled();
      expect(firoService.sendUtxoToMany).not.toHaveBeenCalled();
    });

    it('dispatchPayout(...) treats an empty group as transparent', async () => {
      const isSparkSpy = jest.spyOn(CryptoService, 'isFiroSparkAddress');
      jest.spyOn(firoService, 'sendUtxoToMany').mockResolvedValue('FIRO_EMPTY_TX');
      const payout: PayoutGroup = [];

      await expect(strategy.dispatchPayoutWrapper(CONTEXT, payout)).resolves.toBe('FIRO_EMPTY_TX');

      expect(isSparkSpy).not.toHaveBeenCalled(); // short-circuited by the empty group
      expect(firoService.sendUtxoToMany).toHaveBeenCalledWith(CONTEXT, payout);
    });

    it('doPayoutForContext(...) splits orders into Spark and transparent groups and sends both', async () => {
      const sparkOrder = createCustomPayoutOrder({ id: 1, destinationAddress: 'SPARK_ADDR' });
      const transparentOrder = createCustomPayoutOrder({ id: 2, destinationAddress: 'TRANS_ADDR' });
      jest.spyOn(CryptoService, 'isFiroSparkAddress').mockImplementation((addr) => addr === 'SPARK_ADDR');
      jest
        .spyOn(strategy as any, 'createPayoutGroups')
        .mockImplementation((...args: unknown[]) => [[], args[0] as PayoutOrder[]]);
      const sendSpy = jest.spyOn(strategy as any, 'send').mockResolvedValue(undefined);

      await strategy.doPayoutForContextWrapper(CONTEXT, [sparkOrder, transparentOrder]);

      expect(sendSpy).toHaveBeenCalledTimes(2);
      expect(sendSpy).toHaveBeenNthCalledWith(1, CONTEXT, [sparkOrder]);
      expect(sendSpy).toHaveBeenNthCalledWith(2, CONTEXT, [transparentOrder]);
    });

    it('doPayoutForContext(...) skips the transparent branch when every order is Spark', async () => {
      const sparkOrder = createCustomPayoutOrder({ id: 1, destinationAddress: 'SPARK_ADDR' });
      jest.spyOn(CryptoService, 'isFiroSparkAddress').mockReturnValue(true);
      jest.spyOn(strategy as any, 'createPayoutGroups').mockReturnValue([[sparkOrder]]);
      const sendSpy = jest.spyOn(strategy as any, 'send').mockResolvedValue(undefined);

      await strategy.doPayoutForContextWrapper(CONTEXT, [sparkOrder]);

      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(CONTEXT, [sparkOrder]);
    });

    it('doPayoutForContext(...) swallows a failing transparent group without propagating the error', async () => {
      const transparentOrder = createCustomPayoutOrder({ id: 2, destinationAddress: 'TRANS_ADDR' });
      jest.spyOn(CryptoService, 'isFiroSparkAddress').mockReturnValue(false);
      jest.spyOn(strategy as any, 'createPayoutGroups').mockReturnValue([[transparentOrder]]);
      const sendSpy = jest.spyOn(strategy as any, 'send').mockRejectedValue(new Error('firo send failed'));

      await expect(strategy.doPayoutForContextWrapper(CONTEXT, [transparentOrder])).resolves.toBeUndefined();

      expect(sendSpy).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Wrappers exposing the protected doPayoutForContext / dispatchPayout of the Bitcoin-based leaves
// so they can be driven directly without the full base doPayout() plumbing.
// ---------------------------------------------------------------------------------------------

class BitcoinStrategyWrapper extends BitcoinStrategy {
  doPayoutForContextWrapper(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    return this.doPayoutForContext(context, orders);
  }

  dispatchPayoutWrapper(context: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    return this.dispatchPayout(context, payout);
  }
}

class BitcoinTestnet4StrategyWrapper extends BitcoinTestnet4Strategy {
  doPayoutForContextWrapper(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    return this.doPayoutForContext(context, orders);
  }

  dispatchPayoutWrapper(context: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    return this.dispatchPayout(context, payout);
  }
}

class MoneroStrategyWrapper extends MoneroStrategy {
  doPayoutForContextWrapper(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    return this.doPayoutForContext(context, orders);
  }

  dispatchPayoutWrapper(): Promise<string> {
    return this.dispatchPayout();
  }
}

class FiroStrategyWrapper extends FiroStrategy {
  doPayoutForContextWrapper(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    return this.doPayoutForContext(context, orders);
  }

  dispatchPayoutWrapper(context: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    return this.dispatchPayout(context, payout);
  }
}
