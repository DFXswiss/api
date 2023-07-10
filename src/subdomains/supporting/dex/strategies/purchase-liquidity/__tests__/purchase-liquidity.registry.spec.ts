import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { DexArbitrumService } from '../../../services/dex-arbitrum.service';
import { DexBscService } from '../../../services/dex-bsc.service';
import { DexDeFiChainService } from '../../../services/dex-defichain.service';
import { DexOptimismService } from '../../../services/dex-optimism.service';
import { ArbitrumCoinStrategy } from '../impl/arbitrum-coin.strategy';
import { ArbitrumTokenStrategy } from '../impl/arbitrum-token.strategy';
import { PurchaseLiquidityStrategyRegistry } from '../impl/base/purchase-liquidity.strategy-registry';
import { BitcoinStrategy } from '../impl/bitcoin.strategy';
import { BscCoinStrategy } from '../impl/bsc-coin.strategy';
import { BscTokenStrategy } from '../impl/bsc-token.strategy';
import { DeFiChainCryptoStrategy } from '../impl/defichain-crypto.strategy';
import { DeFiChainDfiStrategy } from '../impl/defichain-dfi.strategy';
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
  let deFiChainStock: DeFiChainStockStrategy;
  let deFiChainCrypto: DeFiChainCryptoStrategy;
  let deFiChainDfi: DeFiChainDfiStrategy;
  let ethereumCoin: EthereumCoinStrategy;
  let ethereumToken: EthereumTokenStrategy;
  let optimismCoin: OptimismCoinStrategy;
  let optimismToken: OptimismTokenStrategy;

  let registry: PurchaseLiquidityStrategyRegistryWrapper;

  beforeEach(() => {
    arbitrumCoin = new ArbitrumCoinStrategy();
    arbitrumToken = new ArbitrumTokenStrategy(mock<DexArbitrumService>());
    bitcoin = new BitcoinStrategy();
    bscCoin = new BscCoinStrategy();
    bscToken = new BscTokenStrategy(mock<DexBscService>());

    deFiChainStock = new DeFiChainStockStrategy(mock<DexDeFiChainService>());
    deFiChainCrypto = new DeFiChainCryptoStrategy(mock<DexDeFiChainService>());

    deFiChainDfi = new DeFiChainDfiStrategy(mock<DexDeFiChainService>());
    ethereumCoin = new EthereumCoinStrategy();
    ethereumToken = new EthereumTokenStrategy(mock<DexBscService>());
    optimismCoin = new OptimismCoinStrategy();
    optimismToken = new OptimismTokenStrategy(mock<DexOptimismService>());

    registry = new PurchaseLiquidityStrategyRegistryWrapper(
      arbitrumCoin,
      arbitrumToken,
      bitcoin,
      bscCoin,
      bscToken,
      deFiChainDfi,
      deFiChainCrypto,
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

      it('returns undefined for non-supported Blockchain', () => {
        const strategy = registry.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: 'NewBlockchain' as Blockchain }),
        );

        expect(strategy).toBeUndefined();
      });

      it('fails to get strategy for non-supported AssetCategory', () => {
        const strategy = registry.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, category: 'NewCategory' as AssetCategory }),
        );

        expect(strategy).toBeUndefined();
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
    deFiChainStock: DeFiChainStockStrategy,
    ethereumCoin: EthereumCoinStrategy,
    ethereumToken: EthereumTokenStrategy,
    optimismCoin: OptimismCoinStrategy,
    optimismToken: OptimismTokenStrategy,
  ) {
    super();

    this.addStrategy({ blockchain: Blockchain.ARBITRUM, assetType: AssetType.COIN }, arbitrumCoin);
    this.addStrategy({ blockchain: Blockchain.ARBITRUM, assetType: AssetType.TOKEN }, arbitrumToken);
    this.addStrategy({ blockchain: Blockchain.BITCOIN, assetType: AssetType.COIN }, bitcoin);
    this.addStrategy({ blockchain: Blockchain.BINANCE_SMART_CHAIN, assetType: AssetType.COIN }, bscCoin);
    this.addStrategy({ blockchain: Blockchain.BINANCE_SMART_CHAIN, assetType: AssetType.TOKEN }, bscToken);
    this.addStrategy(
      { blockchain: Blockchain.DEFICHAIN, assetCategory: AssetCategory.CRYPTO, dexName: 'DFI' },
      deFiChainDfi,
    );
    this.addStrategy({ blockchain: Blockchain.DEFICHAIN, assetCategory: AssetCategory.CRYPTO }, deFiChainCrypto);
    this.addStrategy({ blockchain: Blockchain.DEFICHAIN, assetCategory: AssetCategory.STOCK }, deFiChainStock);
    this.addStrategy({ blockchain: Blockchain.ETHEREUM, assetType: AssetType.COIN }, ethereumCoin);
    this.addStrategy({ blockchain: Blockchain.ETHEREUM, assetType: AssetType.TOKEN }, ethereumToken);
    this.addStrategy({ blockchain: Blockchain.OPTIMISM, assetType: AssetType.COIN }, optimismCoin);
    this.addStrategy({ blockchain: Blockchain.OPTIMISM, assetType: AssetType.TOKEN }, optimismToken);
  }
}
