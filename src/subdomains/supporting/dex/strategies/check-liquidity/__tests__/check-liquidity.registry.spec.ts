import { mock } from 'jest-mock-extended';
import { BitcoinClient } from 'src/integration/blockchain/bitcoin/node/bitcoin-client';
import { BitcoinService } from 'src/integration/blockchain/bitcoin/node/bitcoin.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexArbitrumService } from '../../../services/dex-arbitrum.service';
import { DexBaseService } from '../../../services/dex-base.service';
import { DexBitcoinService } from '../../../services/dex-bitcoin.service';
import { DexBscService } from '../../../services/dex-bsc.service';
import { DexEthereumService } from '../../../services/dex-ethereum.service';
import { DexGnosisService } from '../../../services/dex-gnosis.service';
import { DexLightningService } from '../../../services/dex-lightning.service';
import { DexMoneroService } from '../../../services/dex-monero.service';
import { DexOptimismService } from '../../../services/dex-optimism.service';
import { DexPolygonService } from '../../../services/dex-polygon.service';
import { DexSolanaService } from '../../../services/dex-solana.service';
import { DexTronService } from '../../../services/dex-tron.service';
import { DexZanoService } from '../../../services/dex-zano.service';
import { ArbitrumCoinStrategy } from '../impl/arbitrum-coin.strategy';
import { ArbitrumTokenStrategy } from '../impl/arbitrum-token.strategy';
import { BaseCoinStrategy } from '../impl/base-coin.strategy';
import { BaseTokenStrategy } from '../impl/base-token.strategy';
import { CheckLiquidityStrategyRegistry } from '../impl/base/check-liquidity.strategy-registry';
import { BitcoinStrategy } from '../impl/bitcoin.strategy';
import { BscCoinStrategy } from '../impl/bsc-coin.strategy';
import { BscTokenStrategy } from '../impl/bsc-token.strategy';
import { EthereumCoinStrategy } from '../impl/ethereum-coin.strategy';
import { EthereumTokenStrategy } from '../impl/ethereum-token.strategy';
import { GnosisCoinStrategy } from '../impl/gnosis-coin.strategy';
import { GnosisTokenStrategy } from '../impl/gnosis-token.strategy';
import { LightningStrategy } from '../impl/lightning.strategy';
import { MoneroStrategy } from '../impl/monero.strategy';
import { OptimismCoinStrategy } from '../impl/optimism-coin.strategy';
import { OptimismTokenStrategy } from '../impl/optimism-token.strategy';
import { PolygonCoinStrategy } from '../impl/polygon-coin.strategy';
import { PolygonTokenStrategy } from '../impl/polygon-token.strategy';
import { SolanaCoinStrategy } from '../impl/solana-coin.strategy';
import { SolanaTokenStrategy } from '../impl/solana-token.strategy';
import { TronCoinStrategy } from '../impl/tron-coin.strategy';
import { TronTokenStrategy } from '../impl/tron-token.strategy';
import { ZanoCoinStrategy } from '../impl/zano-coin.strategy';
import { ZanoTokenStrategy } from '../impl/zano-token.strategy';

describe('CheckLiquidityStrategies', () => {
  let bitcoinService: BitcoinService;

  let bitcoin: BitcoinStrategy;
  let lightning: LightningStrategy;
  let monero: MoneroStrategy;
  let zanoCoin: ZanoCoinStrategy;
  let zanoToken: ZanoTokenStrategy;
  let arbitrumCoin: ArbitrumCoinStrategy;
  let arbitrumToken: ArbitrumTokenStrategy;
  let bscCoin: BscCoinStrategy;
  let bscToken: BscTokenStrategy;
  let ethereumCoin: EthereumCoinStrategy;
  let ethereumToken: EthereumTokenStrategy;
  let optimismCoin: OptimismCoinStrategy;
  let optimismToken: OptimismTokenStrategy;
  let polygonCoin: PolygonCoinStrategy;
  let polygonToken: PolygonTokenStrategy;
  let baseCoin: BaseCoinStrategy;
  let baseToken: BaseTokenStrategy;
  let gnosisCoin: GnosisCoinStrategy;
  let gnosisToken: GnosisTokenStrategy;
  let solanaCoin: SolanaCoinStrategy;
  let solanaToken: SolanaTokenStrategy;
  let tronCoin: TronCoinStrategy;
  let tronToken: TronTokenStrategy;

  let register: CheckLiquidityStrategyRegistryWrapper;

  beforeEach(() => {
    bitcoinService = mock<BitcoinService>();
    jest.spyOn(bitcoinService, 'getDefaultClient').mockImplementation(() => new BitcoinClient(null, null));

    bitcoin = new BitcoinStrategy(mock<AssetService>(), mock<DexBitcoinService>());
    lightning = new LightningStrategy(mock<AssetService>(), mock<DexLightningService>());
    monero = new MoneroStrategy(mock<AssetService>(), mock<DexMoneroService>());
    zanoCoin = new ZanoCoinStrategy(mock<AssetService>(), mock<DexZanoService>());
    zanoToken = new ZanoTokenStrategy(mock<AssetService>(), mock<DexZanoService>());
    arbitrumCoin = new ArbitrumCoinStrategy(mock<AssetService>(), mock<DexArbitrumService>());
    arbitrumToken = new ArbitrumTokenStrategy(mock<AssetService>(), mock<DexArbitrumService>());
    bscCoin = new BscCoinStrategy(mock<AssetService>(), mock<DexBscService>());
    bscToken = new BscTokenStrategy(mock<AssetService>(), mock<DexBscService>());
    ethereumCoin = new EthereumCoinStrategy(mock<AssetService>(), mock<DexEthereumService>());
    ethereumToken = new EthereumTokenStrategy(mock<AssetService>(), mock<DexEthereumService>());
    optimismCoin = new OptimismCoinStrategy(mock<AssetService>(), mock<DexOptimismService>());
    optimismToken = new OptimismTokenStrategy(mock<AssetService>(), mock<DexOptimismService>());
    polygonCoin = new PolygonCoinStrategy(mock<AssetService>(), mock<DexPolygonService>());
    polygonToken = new PolygonTokenStrategy(mock<AssetService>(), mock<DexPolygonService>());
    baseCoin = new BaseCoinStrategy(mock<AssetService>(), mock<DexBaseService>());
    baseToken = new BaseTokenStrategy(mock<AssetService>(), mock<DexBaseService>());
    gnosisCoin = new GnosisCoinStrategy(mock<AssetService>(), mock<DexGnosisService>());
    gnosisToken = new GnosisTokenStrategy(mock<AssetService>(), mock<DexGnosisService>());
    solanaCoin = new SolanaCoinStrategy(mock<AssetService>(), mock<DexSolanaService>());
    solanaToken = new SolanaTokenStrategy(mock<AssetService>(), mock<DexSolanaService>());
    tronCoin = new TronCoinStrategy(mock<AssetService>(), mock<DexTronService>());
    tronToken = new TronTokenStrategy(mock<AssetService>(), mock<DexTronService>());

    register = new CheckLiquidityStrategyRegistryWrapper(
      bitcoin,
      lightning,
      monero,
      zanoCoin,
      zanoToken,
      arbitrumCoin,
      arbitrumToken,
      bscCoin,
      bscToken,
      ethereumCoin,
      ethereumToken,
      optimismCoin,
      optimismToken,
      polygonCoin,
      polygonToken,
      baseCoin,
      baseToken,
      gnosisCoin,
      gnosisToken,
      solanaCoin,
      solanaToken,
      tronCoin,
      tronToken,
    );
  });

  describe('#getCheckLiquidityStrategy(...)', () => {
    describe('getting strategy by Asset', () => {
      it('gets BITCOIN strategy for BITCOIN', () => {
        const strategy = register.getCheckLiquidityStrategy(createCustomAsset({ blockchain: Blockchain.BITCOIN }));

        expect(strategy).toBeInstanceOf(BitcoinStrategy);
      });

      it('gets LIGHTNING strategy for LIGHTNING', () => {
        const strategy = register.getCheckLiquidityStrategy(createCustomAsset({ blockchain: Blockchain.LIGHTNING }));

        expect(strategy).toBeInstanceOf(LightningStrategy);
      });

      it('gets MONERO strategy for MONERO', () => {
        const strategy = register.getCheckLiquidityStrategy(createCustomAsset({ blockchain: Blockchain.MONERO }));

        expect(strategy).toBeInstanceOf(MoneroStrategy);
      });

      it('gets ZANO_COIN strategy', () => {
        const strategy = register.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.ZANO, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(ZanoCoinStrategy);
      });

      it('gets ZANO_TOKEN strategy', () => {
        const strategy = register.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.ZANO, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(ZanoTokenStrategy);
      });

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

      it('gets BASE_COIN strategy', () => {
        const strategy = register.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.BASE, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(BaseCoinStrategy);
      });

      it('gets BASE_TOKEN strategy', () => {
        const strategy = register.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.BASE, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(BaseTokenStrategy);
      });

      it('gets GNOSIS_COIN strategy', () => {
        const strategy = register.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.GNOSIS, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(GnosisCoinStrategy);
      });

      it('gets GNOSIS_TOKEN strategy', () => {
        const strategy = register.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.GNOSIS, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(GnosisTokenStrategy);
      });

      it('gets SOLANA_COIN strategy', () => {
        const strategy = register.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.SOLANA, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(SolanaCoinStrategy);
      });

      it('gets SOLANA_TOKEN strategy', () => {
        const strategy = register.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.SOLANA, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(SolanaTokenStrategy);
      });

      it('gets TRON_COIN strategy', () => {
        const strategy = register.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.TRON, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(TronCoinStrategy);
      });

      it('gets TRON_TOKEN strategy', () => {
        const strategy = register.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.TRON, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(TronTokenStrategy);
      });

      it('fails to get strategy for non-supported Blockchain', () => {
        const strategy = register.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: 'NewBlockchain' as Blockchain }),
        );

        expect(strategy).toBeUndefined();
      });
    });
  });
});

class CheckLiquidityStrategyRegistryWrapper extends CheckLiquidityStrategyRegistry {
  constructor(
    bitcoin: BitcoinStrategy,
    lightning: LightningStrategy,
    monero: MoneroStrategy,
    zanoCoin: ZanoCoinStrategy,
    zanoToken: ZanoTokenStrategy,
    arbitrumCoin: ArbitrumCoinStrategy,
    arbitrumToken: ArbitrumTokenStrategy,
    bscCoin: BscCoinStrategy,
    bscToken: BscTokenStrategy,
    ethereumCoin: EthereumCoinStrategy,
    ethereumToken: EthereumTokenStrategy,
    optimismCoin: OptimismCoinStrategy,
    optimismToken: OptimismTokenStrategy,
    polygonCoin: PolygonCoinStrategy,
    polygonToken: PolygonTokenStrategy,
    baseCoin: BaseCoinStrategy,
    baseToken: BaseTokenStrategy,
    gnosisCoin: GnosisCoinStrategy,
    gnosisToken: GnosisTokenStrategy,
    solanaCoin: SolanaCoinStrategy,
    solanaToken: SolanaTokenStrategy,
    tronCoin: TronCoinStrategy,
    tronToken: TronTokenStrategy,
  ) {
    super();

    this.add({ blockchain: Blockchain.BITCOIN }, bitcoin);
    this.add({ blockchain: Blockchain.LIGHTNING }, lightning);
    this.add({ blockchain: Blockchain.MONERO }, monero);
    this.add({ blockchain: Blockchain.ZANO, assetType: AssetType.COIN }, zanoCoin);
    this.add({ blockchain: Blockchain.ZANO, assetType: AssetType.TOKEN }, zanoToken);

    this.add({ blockchain: Blockchain.ARBITRUM, assetType: AssetType.COIN }, arbitrumCoin);
    this.add({ blockchain: Blockchain.ARBITRUM, assetType: AssetType.TOKEN }, arbitrumToken);
    this.add({ blockchain: Blockchain.BINANCE_SMART_CHAIN, assetType: AssetType.COIN }, bscCoin);
    this.add({ blockchain: Blockchain.BINANCE_SMART_CHAIN, assetType: AssetType.TOKEN }, bscToken);
    this.add({ blockchain: Blockchain.ETHEREUM, assetType: AssetType.COIN }, ethereumCoin);
    this.add({ blockchain: Blockchain.ETHEREUM, assetType: AssetType.TOKEN }, ethereumToken);
    this.add({ blockchain: Blockchain.OPTIMISM, assetType: AssetType.COIN }, optimismCoin);
    this.add({ blockchain: Blockchain.OPTIMISM, assetType: AssetType.TOKEN }, optimismToken);
    this.add({ blockchain: Blockchain.POLYGON, assetType: AssetType.COIN }, polygonCoin);
    this.add({ blockchain: Blockchain.POLYGON, assetType: AssetType.TOKEN }, polygonToken);
    this.add({ blockchain: Blockchain.BASE, assetType: AssetType.COIN }, baseCoin);
    this.add({ blockchain: Blockchain.BASE, assetType: AssetType.TOKEN }, baseToken);
    this.add({ blockchain: Blockchain.GNOSIS, assetType: AssetType.COIN }, gnosisCoin);
    this.add({ blockchain: Blockchain.GNOSIS, assetType: AssetType.TOKEN }, gnosisToken);
    this.add({ blockchain: Blockchain.SOLANA, assetType: AssetType.COIN }, solanaCoin);
    this.add({ blockchain: Blockchain.SOLANA, assetType: AssetType.TOKEN }, solanaToken);
    this.add({ blockchain: Blockchain.TRON, assetType: AssetType.COIN }, tronCoin);
    this.add({ blockchain: Blockchain.TRON, assetType: AssetType.TOKEN }, tronToken);
  }
}
