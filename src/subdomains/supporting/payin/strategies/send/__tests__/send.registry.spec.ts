import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInArbitrumService } from '../../../services/payin-arbitrum.service';
import { PayInBaseService } from '../../../services/payin-base.service';
import { PayInBitcoinService } from '../../../services/payin-bitcoin.service';
import { PayInBscService } from '../../../services/payin-bsc.service';
import { PayInEthereumService } from '../../../services/payin-ethereum.service';
import { PayInGnosisService } from '../../../services/payin-gnosis.service';
import { PayInLightningService } from '../../../services/payin-lightning.service';
import { PayInMoneroService } from '../../../services/payin-monero.service';
import { PayInOptimismService } from '../../../services/payin-optimism.service';
import { PayInPolygonService } from '../../../services/payin-polygon.service';
import { PayInSolanaService } from '../../../services/payin-solana.service';
import { PayInTronService } from '../../../services/payin-tron.service';
import { PayInZanoService } from '../../../services/payin-zano.service';
import { PayInCardanoService } from '../../../services/payin-cardano.service';
import { ArbitrumCoinStrategy } from '../impl/arbitrum-coin.strategy';
import { ArbitrumTokenStrategy } from '../impl/arbitrum-token.strategy';
import { BaseCoinStrategy } from '../impl/base-coin.strategy';
import { BaseTokenStrategy } from '../impl/base-token.strategy';
import { SendStrategyRegistry } from '../impl/base/send.strategy-registry';
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
import { CardanoCoinStrategy } from '../impl/cardano-coin.strategy';
import { CardanoTokenStrategy } from '../impl/cardano-token.strategy';

describe('SendStrategyRegistry', () => {
  let bitcoin: BitcoinStrategy;
  let lightning: LightningStrategy;
  let monero: MoneroStrategy;
  let zanoCoin: ZanoCoinStrategy;
  let zanoToken: ZanoTokenStrategy;
  let ethereumCoin: EthereumCoinStrategy;
  let ethereumToken: EthereumTokenStrategy;
  let bscCoin: BscCoinStrategy;
  let bscToken: BscTokenStrategy;
  let arbitrumCoin: ArbitrumCoinStrategy;
  let arbitrumToken: ArbitrumTokenStrategy;
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
  let cardanoCoin: CardanoCoinStrategy;
  let cardanoToken: CardanoTokenStrategy;

  let registry: SendStrategyRegistryWrapper;

  beforeEach(() => {
    bitcoin = new BitcoinStrategy(mock<PayInBitcoinService>(), mock<PayInRepository>());

    lightning = new LightningStrategy(mock<PayInLightningService>(), mock<PayInRepository>());

    monero = new MoneroStrategy(mock<PayInMoneroService>(), mock<PayInRepository>());

    zanoCoin = new ZanoCoinStrategy(mock<PayInZanoService>(), mock<PayInRepository>());
    zanoToken = new ZanoTokenStrategy(mock<PayInZanoService>(), mock<PayInRepository>());

    ethereumCoin = new EthereumCoinStrategy(mock<PayInEthereumService>(), mock<PayInRepository>());
    ethereumToken = new EthereumTokenStrategy(mock<PayInEthereumService>(), mock<PayInRepository>());

    bscCoin = new BscCoinStrategy(mock<PayInBscService>(), mock<PayInRepository>());
    bscToken = new BscTokenStrategy(mock<PayInBscService>(), mock<PayInRepository>());

    arbitrumCoin = new ArbitrumCoinStrategy(mock<PayInArbitrumService>(), mock<PayInRepository>());
    arbitrumToken = new ArbitrumTokenStrategy(mock<PayInArbitrumService>(), mock<PayInRepository>());

    optimismCoin = new OptimismCoinStrategy(mock<PayInOptimismService>(), mock<PayInRepository>());
    optimismToken = new OptimismTokenStrategy(mock<PayInOptimismService>(), mock<PayInRepository>());

    polygonCoin = new PolygonCoinStrategy(mock<PayInPolygonService>(), mock<PayInRepository>());
    polygonToken = new PolygonTokenStrategy(mock<PayInPolygonService>(), mock<PayInRepository>());

    baseCoin = new BaseCoinStrategy(mock<PayInBaseService>(), mock<PayInRepository>());
    baseToken = new BaseTokenStrategy(mock<PayInBaseService>(), mock<PayInRepository>());

    gnosisCoin = new GnosisCoinStrategy(mock<PayInGnosisService>(), mock<PayInRepository>());
    gnosisToken = new GnosisTokenStrategy(mock<PayInGnosisService>(), mock<PayInRepository>());

    solanaCoin = new SolanaCoinStrategy(mock<PayInSolanaService>(), mock<PayInRepository>());
    solanaToken = new SolanaTokenStrategy(mock<PayInSolanaService>(), mock<PayInRepository>());

    tronCoin = new TronCoinStrategy(mock<PayInTronService>(), mock<PayInRepository>());
    tronToken = new TronTokenStrategy(mock<PayInTronService>(), mock<PayInRepository>());

    cardanoCoin = new CardanoCoinStrategy(mock<PayInCardanoService>(), mock<PayInRepository>());
    cardanoToken = new CardanoTokenStrategy(mock<PayInCardanoService>(), mock<PayInRepository>());

    registry = new SendStrategyRegistryWrapper(
      bitcoin,
      lightning,
      monero,
      zanoCoin,
      zanoToken,
      ethereumCoin,
      ethereumToken,
      bscCoin,
      bscToken,
      arbitrumCoin,
      arbitrumToken,
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
      cardanoCoin,
      cardanoToken,
    );
  });

  describe('#getPayoutStrategy(...)', () => {
    describe('getting strategy by Asset', () => {
      it('gets BITCOIN strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.BITCOIN, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(BitcoinStrategy);
      });

      it('gets LIGHTNING strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.LIGHTNING, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(LightningStrategy);
      });

      it('gets MONERO strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.MONERO, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(MoneroStrategy);
      });

      it('gets ZANO_COIN strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.ZANO, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(ZanoCoinStrategy);
      });

      it('gets ZANO_TOKEN strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.ZANO, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(ZanoTokenStrategy);
      });

      it('gets ETHEREUM_COIN strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.ETHEREUM, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(EthereumCoinStrategy);
      });

      it('gets ETHEREUM_TOKEN strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.ETHEREUM, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(EthereumTokenStrategy);
      });

      it('gets BSC_COIN strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(BscCoinStrategy);
      });

      it('gets BSC_TOKEN strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(BscTokenStrategy);
      });

      it('gets ARBITRUM_COIN strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.ARBITRUM, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(ArbitrumCoinStrategy);
      });

      it('gets ARBITRUM_TOKEN strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.ARBITRUM, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(ArbitrumTokenStrategy);
      });

      it('gets OPTIMISM_COIN strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.OPTIMISM, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(OptimismCoinStrategy);
      });

      it('gets OPTIMISM_TOKEN strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.OPTIMISM, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(OptimismTokenStrategy);
      });

      it('gets POLYGON_COIN strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.POLYGON, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(PolygonCoinStrategy);
      });

      it('gets POLYGON_TOKEN strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.POLYGON, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(PolygonTokenStrategy);
      });

      it('gets BASE_COIN strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.BASE, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(BaseCoinStrategy);
      });

      it('gets BASE_TOKEN strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.BASE, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(BaseTokenStrategy);
      });

      it('gets GNOSIS_COIN strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.GNOSIS, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(GnosisCoinStrategy);
      });

      it('gets GNOSIS_TOKEN strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.GNOSIS, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(GnosisTokenStrategy);
      });

      it('gets SOLANA_COIN strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.SOLANA, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(SolanaCoinStrategy);
      });

      it('gets SOLANA_TOKEN strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.SOLANA, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(SolanaTokenStrategy);
      });

      it('gets TRON_COIN strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.TRON, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(TronCoinStrategy);
      });

      it('gets TRON_TOKEN strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.TRON, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(TronTokenStrategy);
      });

      it('gets CARDANO_COIN strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.CARDANO, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(CardanoCoinStrategy);
      });

      it('gets CARDANO_TOKEN strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.CARDANO, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(CardanoTokenStrategy);
      });

      it('fails to get strategy for non-supported Blockchain', () => {
        const testCall = () =>
          registry.getSendStrategy(
            createCustomAsset({ blockchain: 'NewBlockchain' as Blockchain, type: 'NewType' as AssetType }),
          );

        expect(testCall).toThrow();
        expect(testCall).toThrowError('No SendStrategy found. Blockchain: NewBlockchain, AssetType: NewType');
      });
    });
  });
});

class SendStrategyRegistryWrapper extends SendStrategyRegistry {
  constructor(
    bitcoin: BitcoinStrategy,
    lightning: LightningStrategy,
    monero: MoneroStrategy,
    zanoCoin: ZanoCoinStrategy,
    zanoToken: ZanoTokenStrategy,
    ethereumCoin: EthereumCoinStrategy,
    ethereumToken: EthereumTokenStrategy,
    bscCoin: BscCoinStrategy,
    bscToken: BscTokenStrategy,
    arbitrumCoin: ArbitrumCoinStrategy,
    arbitrumToken: ArbitrumTokenStrategy,
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
    cardanoCoin: CardanoCoinStrategy,
    cardanoToken: CardanoTokenStrategy,
  ) {
    super();

    this.add({ blockchain: Blockchain.BITCOIN }, bitcoin);
    this.add({ blockchain: Blockchain.LIGHTNING }, lightning);
    this.add({ blockchain: Blockchain.MONERO }, monero);
    this.add({ blockchain: Blockchain.ZANO, assetType: AssetType.COIN }, zanoCoin);
    this.add({ blockchain: Blockchain.ZANO, assetType: AssetType.TOKEN }, zanoToken);

    this.add({ blockchain: Blockchain.ETHEREUM, assetType: AssetType.COIN }, ethereumCoin);
    this.add({ blockchain: Blockchain.ETHEREUM, assetType: AssetType.TOKEN }, ethereumToken);
    this.add({ blockchain: Blockchain.BINANCE_SMART_CHAIN, assetType: AssetType.COIN }, bscCoin);
    this.add({ blockchain: Blockchain.BINANCE_SMART_CHAIN, assetType: AssetType.TOKEN }, bscToken);
    this.add({ blockchain: Blockchain.ARBITRUM, assetType: AssetType.COIN }, arbitrumCoin);
    this.add({ blockchain: Blockchain.ARBITRUM, assetType: AssetType.TOKEN }, arbitrumToken);
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
    this.add({ blockchain: Blockchain.CARDANO, assetType: AssetType.COIN }, cardanoCoin);
    this.add({ blockchain: Blockchain.CARDANO, assetType: AssetType.TOKEN }, cardanoToken);
  }
}
