import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { DexArbitrumService } from '../../../services/dex-arbitrum.service';
import { DexBaseService } from '../../../services/dex-base.service';
import { DexBscService } from '../../../services/dex-bsc.service';
import { DexEthereumService } from '../../../services/dex-ethereum.service';
import { DexOptimismService } from '../../../services/dex-optimism.service';
import { DexPolygonService } from '../../../services/dex-polygon.service';
import { ArbitrumCoinStrategy } from '../impl/arbitrum-coin.strategy';
import { ArbitrumTokenStrategy } from '../impl/arbitrum-token.strategy';
import { BaseCoinStrategy } from '../impl/base-coin.strategy';
import { BaseTokenStrategy } from '../impl/base-token.strategy';
import { PurchaseLiquidityStrategyRegistry } from '../impl/base/purchase-liquidity.strategy-registry';
import { BitcoinStrategy } from '../impl/bitcoin.strategy';
import { BscCoinStrategy } from '../impl/bsc-coin.strategy';
import { BscTokenStrategy } from '../impl/bsc-token.strategy';
import { EthereumCoinStrategy } from '../impl/ethereum-coin.strategy';
import { EthereumTokenStrategy } from '../impl/ethereum-token.strategy';
import { MoneroStrategy } from '../impl/monero.strategy';
import { OptimismCoinStrategy } from '../impl/optimism-coin.strategy';
import { OptimismTokenStrategy } from '../impl/optimism-token.strategy';
import { PolygonCoinStrategy } from '../impl/polygon-coin.strategy';
import { PolygonTokenStrategy } from '../impl/polygon-token.strategy';

describe('PurchaseLiquidityStrategyRegistry', () => {
  let arbitrumCoin: ArbitrumCoinStrategy;
  let arbitrumToken: ArbitrumTokenStrategy;
  let bitcoin: BitcoinStrategy;
  let bscCoin: BscCoinStrategy;
  let bscToken: BscTokenStrategy;
  let ethereumCoin: EthereumCoinStrategy;
  let ethereumToken: EthereumTokenStrategy;
  let monero: MoneroStrategy;
  let optimismCoin: OptimismCoinStrategy;
  let optimismToken: OptimismTokenStrategy;
  let polygonCoin: PolygonCoinStrategy;
  let polygonToken: PolygonTokenStrategy;
  let baseCoin: BaseCoinStrategy;
  let baseToken: BaseTokenStrategy;

  let registry: PurchaseLiquidityStrategyRegistryWrapper;

  beforeEach(() => {
    arbitrumCoin = new ArbitrumCoinStrategy(mock<DexArbitrumService>());
    arbitrumToken = new ArbitrumTokenStrategy(mock<DexArbitrumService>());
    bitcoin = new BitcoinStrategy();
    bscCoin = new BscCoinStrategy(mock<DexBscService>());
    bscToken = new BscTokenStrategy(mock<DexBscService>());

    ethereumCoin = new EthereumCoinStrategy(mock<DexEthereumService>());
    ethereumToken = new EthereumTokenStrategy(mock<DexEthereumService>());

    monero = new MoneroStrategy();

    optimismCoin = new OptimismCoinStrategy(mock<DexOptimismService>());
    optimismToken = new OptimismTokenStrategy(mock<DexOptimismService>());

    polygonCoin = new PolygonCoinStrategy(mock<DexPolygonService>());
    polygonToken = new PolygonTokenStrategy(mock<DexPolygonService>());

    baseCoin = new BaseCoinStrategy(mock<DexBaseService>());
    baseToken = new BaseTokenStrategy(mock<DexBaseService>());

    registry = new PurchaseLiquidityStrategyRegistryWrapper(
      arbitrumCoin,
      arbitrumToken,
      bitcoin,
      bscCoin,
      bscToken,
      ethereumCoin,
      ethereumToken,
      monero,
      optimismCoin,
      optimismToken,
      polygonCoin,
      polygonToken,
      baseCoin,
      baseToken,
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
        const strategy = registry.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.BITCOIN, type: AssetType.COIN }),
        );

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

      it('gets MONERO strategy for MONERO Crypto', () => {
        const strategy = registry.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.MONERO, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(MoneroStrategy);
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

      it('gets POLYGON_COIN strategy', () => {
        const strategy = registry.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.POLYGON, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(PolygonCoinStrategy);
      });

      it('gets POLYGON_TOKEN strategy', () => {
        const strategy = registry.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.POLYGON, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(PolygonTokenStrategy);
      });

      it('gets BASE_COIN strategy', () => {
        const strategy = registry.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.BASE, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(BaseCoinStrategy);
      });

      it('gets BASE_TOKEN strategy', () => {
        const strategy = registry.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.BASE, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(BaseTokenStrategy);
      });

      it('fails to get strategy for non-supported Blockchain', () => {
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
    ethereumCoin: EthereumCoinStrategy,
    ethereumToken: EthereumTokenStrategy,
    monero: MoneroStrategy,
    optimismCoin: OptimismCoinStrategy,
    optimismToken: OptimismTokenStrategy,
    polygonCoin: PolygonCoinStrategy,
    polygonToken: PolygonTokenStrategy,
    baseCoin: BaseCoinStrategy,
    baseToken: BaseTokenStrategy,
  ) {
    super();

    this.add({ blockchain: Blockchain.ARBITRUM, assetType: AssetType.COIN }, arbitrumCoin);
    this.add({ blockchain: Blockchain.ARBITRUM, assetType: AssetType.TOKEN }, arbitrumToken);
    this.add({ blockchain: Blockchain.BITCOIN, assetType: AssetType.COIN }, bitcoin);
    this.add({ blockchain: Blockchain.BINANCE_SMART_CHAIN, assetType: AssetType.COIN }, bscCoin);
    this.add({ blockchain: Blockchain.BINANCE_SMART_CHAIN, assetType: AssetType.TOKEN }, bscToken);
    this.add({ blockchain: Blockchain.ETHEREUM, assetType: AssetType.COIN }, ethereumCoin);
    this.add({ blockchain: Blockchain.ETHEREUM, assetType: AssetType.TOKEN }, ethereumToken);
    this.add({ blockchain: Blockchain.MONERO, assetType: AssetType.COIN }, monero);
    this.add({ blockchain: Blockchain.OPTIMISM, assetType: AssetType.COIN }, optimismCoin);
    this.add({ blockchain: Blockchain.OPTIMISM, assetType: AssetType.TOKEN }, optimismToken);
    this.add({ blockchain: Blockchain.POLYGON, assetType: AssetType.COIN }, polygonCoin);
    this.add({ blockchain: Blockchain.POLYGON, assetType: AssetType.TOKEN }, polygonToken);
    this.add({ blockchain: Blockchain.BASE, assetType: AssetType.COIN }, baseCoin);
    this.add({ blockchain: Blockchain.BASE, assetType: AssetType.TOKEN }, baseToken);
  }
}
