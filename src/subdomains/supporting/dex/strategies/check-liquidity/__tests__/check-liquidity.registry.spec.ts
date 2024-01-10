import { mock } from 'jest-mock-extended';
import { BehaviorSubject } from 'rxjs';
import { NodeService } from 'src/integration/blockchain/ain/node/node.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexArbitrumService } from '../../../services/dex-arbitrum.service';
import { DexBitcoinService } from '../../../services/dex-bitcoin.service';
import { DexBscService } from '../../../services/dex-bsc.service';
import { DexDeFiChainService } from '../../../services/dex-defichain.service';
import { DexEthereumService } from '../../../services/dex-ethereum.service';
import { DexLightningService } from '../../../services/dex-lightning.service';
import { DexMoneroService } from '../../../services/dex-monero.service';
import { DexOptimismService } from '../../../services/dex-optimism.service';
import { PurchaseLiquidityStrategyRegistry } from '../../purchase-liquidity/impl/base/purchase-liquidity.strategy-registry';
import { ArbitrumCoinStrategy } from '../impl/arbitrum-coin.strategy';
import { ArbitrumTokenStrategy } from '../impl/arbitrum-token.strategy';
import { CheckLiquidityStrategyRegistry } from '../impl/base/check-liquidity.strategy-registry';
import { BitcoinStrategy } from '../impl/bitcoin.strategy';
import { BscCoinStrategy } from '../impl/bsc-coin.strategy';
import { BscTokenStrategy } from '../impl/bsc-token.strategy';
import { DeFiChainDefaultStrategy } from '../impl/defichain-default.strategy';
import { DeFiChainPoolPairStrategy } from '../impl/defichain-poolpair.strategy';
import { EthereumCoinStrategy } from '../impl/ethereum-coin.strategy';
import { EthereumTokenStrategy } from '../impl/ethereum-token.strategy';
import { LightningStrategy } from '../impl/lightning.strategy';
import { MoneroStrategy } from '../impl/monero.strategy';
import { OptimismCoinStrategy } from '../impl/optimism-coin.strategy';
import { OptimismTokenStrategy } from '../impl/optimism-token.strategy';
import { PolygonCoinStrategy } from '../impl/polygon-coin.strategy';
import { PolygonTokenStrategy } from '../impl/polygon-token.strategy';

describe('CheckLiquidityStrategies', () => {
  let nodeService: NodeService;

  let arbitrumCoin: ArbitrumCoinStrategy;
  let arbitrumToken: ArbitrumTokenStrategy;
  let bitcoin: BitcoinStrategy;
  let bscCoin: BscCoinStrategy;
  let bscToken: BscTokenStrategy;
  let deFiChainPoolPair: DeFiChainPoolPairStrategy;
  let deFiChainDefault: DeFiChainDefaultStrategy;
  let ethereumCoin: EthereumCoinStrategy;
  let ethereumToken: EthereumTokenStrategy;
  let lightning: LightningStrategy;
  let monero: MoneroStrategy;
  let optimismCoin: OptimismCoinStrategy;
  let optimismToken: OptimismTokenStrategy;
  let polygonCoin: PolygonCoinStrategy;
  let polygonToken: PolygonTokenStrategy;

  let register: CheckLiquidityStrategyRegistryWrapper;

  beforeEach(() => {
    nodeService = mock<NodeService>();
    jest.spyOn(nodeService, 'getConnectedNode').mockImplementation(() => new BehaviorSubject(null));

    arbitrumCoin = new ArbitrumCoinStrategy(mock<AssetService>(), mock<DexArbitrumService>());
    arbitrumToken = new ArbitrumTokenStrategy(mock<AssetService>(), mock<DexArbitrumService>());
    bitcoin = new BitcoinStrategy(mock<AssetService>(), mock<DexBitcoinService>());
    bscCoin = new BscCoinStrategy(mock<AssetService>(), mock<DexBscService>());
    bscToken = new BscTokenStrategy(mock<AssetService>(), mock<DexBscService>());
    deFiChainPoolPair = new DeFiChainPoolPairStrategy(mock<AssetService>(), mock<DexDeFiChainService>());
    deFiChainDefault = new DeFiChainDefaultStrategy(
      mock<AssetService>(),
      mock<DexDeFiChainService>(),
      mock<PurchaseLiquidityStrategyRegistry>(),
    );
    ethereumCoin = new EthereumCoinStrategy(mock<AssetService>(), mock<DexEthereumService>());
    ethereumToken = new EthereumTokenStrategy(mock<AssetService>(), mock<DexEthereumService>());
    lightning = new LightningStrategy(mock<AssetService>(), mock<DexLightningService>());
    monero = new MoneroStrategy(mock<AssetService>(), mock<DexMoneroService>());
    optimismCoin = new OptimismCoinStrategy(mock<AssetService>(), mock<DexOptimismService>());
    optimismToken = new OptimismTokenStrategy(mock<AssetService>(), mock<DexOptimismService>());
    polygonCoin = new PolygonCoinStrategy(mock<AssetService>(), mock<DexOptimismService>());
    polygonToken = new PolygonTokenStrategy(mock<AssetService>(), mock<DexOptimismService>());

    register = new CheckLiquidityStrategyRegistryWrapper(
      arbitrumCoin,
      arbitrumToken,
      bitcoin,
      bscCoin,
      bscToken,
      deFiChainDefault,
      deFiChainPoolPair,
      ethereumCoin,
      ethereumToken,
      lightning,
      monero,
      optimismCoin,
      optimismToken,
      polygonCoin,
      polygonToken,
    );
  });

  describe('#getCheckLiquidityStrategy(...)', () => {
    describe('getting strategy by Asset', () => {
      it('gets ARBITRUM_COIN strategy', () => {
        const strategy = register.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.ARBITRUM, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(ArbitrumCoinStrategy);
      });

      it('gets ARBITRUM_TOKEN strategy', () => {
        const strategy = register.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.ARBITRUM, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(ArbitrumTokenStrategy);
      });

      it('gets BITCOIN strategy for BITCOIN', () => {
        const strategy = register.getCheckLiquidityStrategy(createCustomAsset({ blockchain: Blockchain.BITCOIN }));

        expect(strategy).toBeInstanceOf(BitcoinStrategy);
      });

      it('gets BSC_COIN strategy', () => {
        const strategy = register.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(BscCoinStrategy);
      });

      it('gets BSC_TOKEN strategy', () => {
        const strategy = register.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(BscTokenStrategy);
      });

      it('gets DEFICHAIN_POOL_PAIR strategy for DEFICHAIN', () => {
        const strategy = register.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, category: AssetCategory.POOL_PAIR }),
        );

        expect(strategy).toBeInstanceOf(DeFiChainPoolPairStrategy);
      });

      it('gets DEFICHAIN_DEFAULT strategy for DEFICHAIN', () => {
        const strategyCrypto = register.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, category: AssetCategory.CRYPTO }),
        );

        expect(strategyCrypto).toBeInstanceOf(DeFiChainDefaultStrategy);

        const strategyStock = register.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, category: AssetCategory.STOCK }),
        );

        expect(strategyStock).toBeInstanceOf(DeFiChainDefaultStrategy);
      });

      it('gets ETHEREUM_COIN strategy', () => {
        const strategy = register.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.ETHEREUM, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(EthereumCoinStrategy);
      });

      it('gets ETHEREUM_TOKEN strategy', () => {
        const strategy = register.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.ETHEREUM, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(EthereumTokenStrategy);
      });

      it('gets LIGHTNING strategy for LIGHTNING', () => {
        const strategy = register.getCheckLiquidityStrategy(createCustomAsset({ blockchain: Blockchain.LIGHTNING }));

        expect(strategy).toBeInstanceOf(LightningStrategy);
      });

      it('gets MONERO strategy for MONERO', () => {
        const strategy = register.getCheckLiquidityStrategy(createCustomAsset({ blockchain: Blockchain.MONERO }));

        expect(strategy).toBeInstanceOf(MoneroStrategy);
      });

      it('gets OPTIMISM_COIN strategy', () => {
        const strategy = register.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.OPTIMISM, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(OptimismCoinStrategy);
      });

      it('gets OPTIMISM_TOKEN strategy', () => {
        const strategy = register.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.OPTIMISM, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(OptimismTokenStrategy);
      });

      it('gets POLYGON_COIN strategy', () => {
        const strategy = register.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.POLYGON, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(PolygonCoinStrategy);
      });

      it('gets POLYGON_TOKEN strategy', () => {
        const strategy = register.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.POLYGON, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(PolygonTokenStrategy);
      });

      it('fails to get strategy for non-supported Blockchain', () => {
        const testCall = () =>
          register.getCheckLiquidityStrategy(createCustomAsset({ blockchain: 'NewBlockchain' as Blockchain }));

        expect(testCall).toThrow();
        expect(testCall).toThrowError('No CheckLiquidityStrategy found. Blockchain: NewBlockchain, AssetType: Coin');
      });
    });
  });
});

class CheckLiquidityStrategyRegistryWrapper extends CheckLiquidityStrategyRegistry {
  constructor(
    arbitrumCoin: ArbitrumCoinStrategy,
    arbitrumToken: ArbitrumTokenStrategy,
    bitcoin: BitcoinStrategy,
    bscCoin: BscCoinStrategy,
    bscToken: BscTokenStrategy,
    deFiChainDefault: DeFiChainDefaultStrategy,
    deFiChainPoolPair: DeFiChainPoolPairStrategy,
    ethereumCoin: EthereumCoinStrategy,
    ethereumToken: EthereumTokenStrategy,
    lightning: LightningStrategy,
    monero: MoneroStrategy,
    optimismCoin: OptimismCoinStrategy,
    optimismToken: OptimismTokenStrategy,
    polygonCoin: PolygonCoinStrategy,
    polygonToken: PolygonTokenStrategy,
  ) {
    super();

    this.addStrategy({ blockchain: Blockchain.ARBITRUM, assetType: AssetType.COIN }, arbitrumCoin);
    this.addStrategy({ blockchain: Blockchain.ARBITRUM, assetType: AssetType.TOKEN }, arbitrumToken);
    this.addStrategy({ blockchain: Blockchain.BITCOIN }, bitcoin);
    this.addStrategy({ blockchain: Blockchain.BINANCE_SMART_CHAIN, assetType: AssetType.COIN }, bscCoin);
    this.addStrategy({ blockchain: Blockchain.BINANCE_SMART_CHAIN, assetType: AssetType.TOKEN }, bscToken);
    this.addStrategy({ blockchain: Blockchain.DEFICHAIN, assetCategory: AssetCategory.CRYPTO }, deFiChainDefault);
    this.addStrategy({ blockchain: Blockchain.DEFICHAIN, assetCategory: AssetCategory.STOCK }, deFiChainDefault);
    this.addStrategy({ blockchain: Blockchain.DEFICHAIN, assetCategory: AssetCategory.POOL_PAIR }, deFiChainPoolPair);
    this.addStrategy({ blockchain: Blockchain.ETHEREUM, assetType: AssetType.COIN }, ethereumCoin);
    this.addStrategy({ blockchain: Blockchain.ETHEREUM, assetType: AssetType.TOKEN }, ethereumToken);
    this.addStrategy({ blockchain: Blockchain.LIGHTNING }, lightning);
    this.addStrategy({ blockchain: Blockchain.MONERO }, monero);
    this.addStrategy({ blockchain: Blockchain.OPTIMISM, assetType: AssetType.COIN }, optimismCoin);
    this.addStrategy({ blockchain: Blockchain.OPTIMISM, assetType: AssetType.TOKEN }, optimismToken);
    this.addStrategy({ blockchain: Blockchain.POLYGON, assetType: AssetType.COIN }, polygonCoin);
    this.addStrategy({ blockchain: Blockchain.POLYGON, assetType: AssetType.TOKEN }, polygonToken);
  }
}
