import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { LiquidityOrderFactory } from '../../../factories/liquidity-order.factory';
import { LiquidityOrderRepository } from '../../../repositories/liquidity-order.repository';
import { DexArbitrumService } from '../../../services/dex-arbitrum.service';
import { DexBitcoinService } from '../../../services/dex-bitcoin.service';
import { DexBscService } from '../../../services/dex-bsc.service';
import { DexDeFiChainService } from '../../../services/dex-defichain.service';
import { DexOptimismService } from '../../../services/dex-optimism.service';
import { DexService } from '../../../services/dex.service';
import { ArbitrumCoinStrategy } from '../impl/arbitrum-coin.strategy';
import { ArbitrumTokenStrategy } from '../impl/arbitrum-token.strategy';
import { PurchaseLiquidityStrategyRegistry } from '../impl/base/purchase-liquidity.strategy-registry';
import { BitcoinStrategy } from '../impl/bitcoin.strategy';
import { BscCoinStrategy } from '../impl/bsc-coin.strategy';
import { BscTokenStrategy } from '../impl/bsc-token.strategy';
import { DeFiChainCryptoStrategy } from '../impl/defichain-crypto.strategy';
import { DeFiChainDfiStrategy } from '../impl/defichain-dfi.strategy';
import { DeFiChainPoolPairStrategy } from '../impl/defichain-poolpair.strategy';
import { DeFiChainStockStrategy } from '../impl/defichain-stock.strategy';
import { EthereumCoinStrategy } from '../impl/ethereum-coin.strategy';
import { EthereumTokenStrategy } from '../impl/ethereum-token.strategy';
import { OptimismCoinStrategy } from '../impl/optimism-coin.strategy';
import { OptimismTokenStrategy } from '../impl/optimism-token.strategy';

describe('PurchaseLiquidityStrategyRegistry', () => {
  let arbitrumCoin: ArbitrumCoinStrategy;
  let arbitrumToken: ArbitrumTokenStrategy;
  let bitcoin: BitcoinStrategy;
  let bscCoin: BscCoinStrategy;
  let bscToken: BscTokenStrategy;
  let deFiChainPoolPair: DeFiChainPoolPairStrategy;
  let deFiChainStock: DeFiChainStockStrategy;
  let deFiChainCrypto: DeFiChainCryptoStrategy;
  let deFiChainDfi: DeFiChainDfiStrategy;
  let ethereumCoin: EthereumCoinStrategy;
  let ethereumToken: EthereumTokenStrategy;
  let optimismCoin: OptimismCoinStrategy;
  let optimismToken: OptimismTokenStrategy;

  let registry: PurchaseLiquidityStrategyRegistryWrapper;

  beforeEach(() => {
    arbitrumCoin = new ArbitrumCoinStrategy(
      mock<AssetService>(),
      mock<NotificationService>(),
      mock<DexArbitrumService>(),
    );
    arbitrumToken = new ArbitrumTokenStrategy(
      mock<AssetService>(),
      mock<NotificationService>(),
      mock<DexArbitrumService>(),
    );
    bitcoin = new BitcoinStrategy(mock<AssetService>(), mock<NotificationService>(), mock<DexBitcoinService>());
    bscCoin = new BscCoinStrategy(mock<AssetService>(), mock<NotificationService>(), mock<DexBscService>());
    bscToken = new BscTokenStrategy(mock<AssetService>(), mock<NotificationService>(), mock<DexBscService>());

    deFiChainPoolPair = new DeFiChainPoolPairStrategy(
      mock<NotificationService>(),
      mock<AssetService>(),
      mock<LiquidityOrderRepository>(),
      mock<LiquidityOrderFactory>(),
      mock<DexService>(),
      mock<DexDeFiChainService>(),
    );
    deFiChainStock = new DeFiChainStockStrategy(
      mock<NotificationService>(),
      mock<AssetService>(),
      mock<DexDeFiChainService>(),
      mock<LiquidityOrderRepository>(),
      mock<LiquidityOrderFactory>(),
    );
    deFiChainCrypto = new DeFiChainCryptoStrategy(
      mock<NotificationService>(),
      mock<AssetService>(),
      mock<DexDeFiChainService>(),
      mock<LiquidityOrderRepository>(),
      mock<LiquidityOrderFactory>(),
    );

    deFiChainDfi = new DeFiChainDfiStrategy(
      mock<NotificationService>(),
      mock<AssetService>(),
      mock<DexDeFiChainService>(),
      mock<LiquidityOrderRepository>(),
      mock<LiquidityOrderFactory>(),
    );
    ethereumCoin = new EthereumCoinStrategy(mock<AssetService>(), mock<NotificationService>(), mock<DexBscService>());
    ethereumToken = new EthereumTokenStrategy(mock<AssetService>(), mock<NotificationService>(), mock<DexBscService>());
    optimismCoin = new OptimismCoinStrategy(
      mock<AssetService>(),
      mock<NotificationService>(),
      mock<DexOptimismService>(),
    );
    optimismToken = new OptimismTokenStrategy(
      mock<AssetService>(),
      mock<NotificationService>(),
      mock<DexOptimismService>(),
    );

    registry = new PurchaseLiquidityStrategyRegistryWrapper(
      arbitrumCoin,
      arbitrumToken,
      bitcoin,
      bscCoin,
      bscToken,
      deFiChainDfi,
      deFiChainCrypto,
      deFiChainPoolPair,
      deFiChainStock,
      ethereumCoin,
      ethereumToken,
      optimismCoin,
      optimismToken,
    );
  });

  describe('#getPurchaseLiquidityStrategy(...)', () => {
    describe('getting strategy by Asset', () => {
      it('gets ARBITRUM_COIN strategy', () => {
        const strategy = registry.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.ARBITRUM, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(ArbitrumCoinStrategy);
      });

      it('gets ARBITRUM_TOKEN strategy', () => {
        const strategy = registry.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.ARBITRUM, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(ArbitrumTokenStrategy);
      });

      it('gets BITCOIN strategy for BITCOIN Crypto', () => {
        const strategy = registry.getPurchaseLiquidityStrategy(createCustomAsset({ blockchain: Blockchain.BITCOIN }));

        expect(strategy).toBeInstanceOf(BitcoinStrategy);
      });

      it('gets BSC_COIN strategy', () => {
        const strategy = registry.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(BscCoinStrategy);
      });

      it('gets BSC_TOKEN strategy', () => {
        const strategy = registry.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(BscTokenStrategy);
      });

      it('gets DEFICHAIN_DFI strategy for DEFICHAIN Crypto', () => {
        const strategy = registry.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, category: AssetCategory.CRYPTO, dexName: 'DFI' }),
        );

        expect(strategy).toBeInstanceOf(DeFiChainDfiStrategy);
      });

      it('gets DEFICHAIN_CRYPTO strategy for DEFICHAIN Crypto', () => {
        const strategy = registry.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, category: AssetCategory.CRYPTO }),
        );

        expect(strategy).toBeInstanceOf(DeFiChainCryptoStrategy);
      });

      it('gets DEFICHAIN_POOL_PAIR strategy for DEFICHAIN Pool Pair', () => {
        const strategy = registry.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, category: AssetCategory.POOL_PAIR }),
        );

        expect(strategy).toBeInstanceOf(DeFiChainPoolPairStrategy);
      });

      it('gets DEFICHAIN_STOCK strategy for DEFICHAIN Stock', () => {
        const strategy = registry.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, category: AssetCategory.STOCK }),
        );

        expect(strategy).toBeInstanceOf(DeFiChainStockStrategy);
      });

      it('gets ETHEREUM_COIN strategy', () => {
        const strategy = registry.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.ETHEREUM, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(EthereumCoinStrategy);
      });

      it('gets ETHEREUM_TOKEN strategy', () => {
        const strategy = registry.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.ETHEREUM, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(EthereumTokenStrategy);
      });

      it('gets OPTIMISM_COIN strategy', () => {
        const strategy = registry.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.OPTIMISM, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(OptimismCoinStrategy);
      });

      it('gets OPTIMISM_TOKEN strategy', () => {
        const strategy = registry.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.OPTIMISM, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(OptimismTokenStrategy);
      });

      it('fails to get strategy for non-supported Blockchain', () => {
        const testCall = () =>
          registry.getPurchaseLiquidityStrategy(createCustomAsset({ blockchain: 'NewBlockchain' as Blockchain }));

        expect(testCall).toThrow();
        expect(testCall).toThrowError('No PurchaseLiquidityStrategy found. Blockchain: NewBlockchain, AssetType: Coin');
      });

      it('fails to get strategy for non-supported AssetCategory', () => {
        const testCall = () =>
          registry.getPurchaseLiquidityStrategy(
            createCustomAsset({ blockchain: Blockchain.DEFICHAIN, category: 'NewCategory' as AssetCategory }),
          );

        expect(testCall).toThrow();
        expect(testCall).toThrowError('No PurchaseLiquidityStrategy found. Blockchain: DeFiChain, AssetType: Coin');
      });
    });
  });
});

class PurchaseLiquidityStrategyRegistryWrapper extends PurchaseLiquidityStrategyRegistry {
  constructor(
    arbitrumCoin: ArbitrumCoinStrategy,
    arbitrumToken: ArbitrumTokenStrategy,
    bitcoin: BitcoinStrategy,
    bscCoin: BscCoinStrategy,
    bscToken: BscTokenStrategy,
    deFiChainDfi: DeFiChainDfiStrategy,
    deFiChainCrypto: DeFiChainCryptoStrategy,
    deFiChainPoolPair: DeFiChainPoolPairStrategy,
    deFiChainStock: DeFiChainStockStrategy,
    ethereumCoin: EthereumCoinStrategy,
    ethereumToken: EthereumTokenStrategy,
    optimismCoin: OptimismCoinStrategy,
    optimismToken: OptimismTokenStrategy,
  ) {
    super();

    this.add({ blockchain: Blockchain.ARBITRUM, assetType: AssetType.COIN }, arbitrumCoin);
    this.add({ blockchain: Blockchain.ARBITRUM, assetType: AssetType.TOKEN }, arbitrumToken);
    this.add({ blockchain: Blockchain.BITCOIN, assetType: AssetType.COIN }, bitcoin);
    this.add({ blockchain: Blockchain.BINANCE_SMART_CHAIN, assetType: AssetType.COIN }, bscCoin);
    this.add({ blockchain: Blockchain.BINANCE_SMART_CHAIN, assetType: AssetType.TOKEN }, bscToken);
    this.add({ blockchain: Blockchain.DEFICHAIN, assetCategory: AssetCategory.CRYPTO, dexName: 'DFI' }, deFiChainDfi);
    this.add({ blockchain: Blockchain.DEFICHAIN, assetCategory: AssetCategory.CRYPTO }, deFiChainCrypto);
    this.add({ blockchain: Blockchain.DEFICHAIN, assetCategory: AssetCategory.POOL_PAIR }, deFiChainPoolPair);
    this.add({ blockchain: Blockchain.DEFICHAIN, assetCategory: AssetCategory.STOCK }, deFiChainStock);
    this.add({ blockchain: Blockchain.ETHEREUM, assetType: AssetType.COIN }, ethereumCoin);
    this.add({ blockchain: Blockchain.ETHEREUM, assetType: AssetType.TOKEN }, ethereumToken);
    this.add({ blockchain: Blockchain.OPTIMISM, assetType: AssetType.COIN }, optimismCoin);
    this.add({ blockchain: Blockchain.OPTIMISM, assetType: AssetType.TOKEN }, optimismToken);
  }
}
