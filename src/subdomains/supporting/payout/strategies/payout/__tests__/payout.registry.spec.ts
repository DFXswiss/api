import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutArbitrumService } from '../../../services/payout-arbitrum.service';
import { PayoutBaseService } from '../../../services/payout-base.service';
import { PayoutBitcoinService } from '../../../services/payout-bitcoin.service';
import { PayoutBscService } from '../../../services/payout-bsc.service';
import { PayoutEthereumService } from '../../../services/payout-ethereum.service';
import { PayoutGnosisService } from '../../../services/payout-gnosis.service';
import { PayoutLightningService } from '../../../services/payout-lightning.service';
import { PayoutMoneroService } from '../../../services/payout-monero.service';
import { PayoutOptimismService } from '../../../services/payout-optimism.service';
import { PayoutPolygonService } from '../../../services/payout-polygon.service';
import { PayoutSolanaService } from '../../../services/payout-solana.service';
import { PayoutTronService } from '../../../services/payout-tron.service';
import { PayoutZanoService } from '../../../services/payout-zano.service';
import { ArbitrumCoinStrategy } from '../impl/arbitrum-coin.strategy';
import { ArbitrumTokenStrategy } from '../impl/arbitrum-token.strategy';
import { BaseCoinStrategy } from '../impl/base-coin.strategy';
import { BaseTokenStrategy } from '../impl/base-token.strategy';
import { PayoutStrategyRegistry } from '../impl/base/payout.strategy-registry';
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

describe('PayoutStrategyRegistry', () => {
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

  let registry: PayoutStrategyRegistryWrapper;

  beforeEach(() => {
    bitcoin = new BitcoinStrategy(
      mock<NotificationService>(),
      mock<PayoutBitcoinService>(),
      mock<PayoutOrderRepository>(),
      mock<AssetService>(),
    );
    lightning = new LightningStrategy(
      mock<AssetService>(),
      mock<PayoutLightningService>(),
      mock<PayoutOrderRepository>(),
    );
    monero = new MoneroStrategy(
      mock<NotificationService>(),
      mock<PayoutMoneroService>(),
      mock<PayoutOrderRepository>(),
      mock<AssetService>(),
    );
    zanoCoin = new ZanoCoinStrategy(
      mock<NotificationService>(),
      mock<PayoutOrderRepository>(),
      mock<PayoutZanoService>(),
      mock<AssetService>(),
    );
    zanoToken = new ZanoTokenStrategy(
      mock<NotificationService>(),
      mock<PayoutOrderRepository>(),
      mock<PayoutZanoService>(),
      mock<AssetService>(),
    );
    arbitrumCoin = new ArbitrumCoinStrategy(
      mock<PayoutArbitrumService>(),
      mock<AssetService>(),
      mock<PayoutOrderRepository>(),
    );
    arbitrumToken = new ArbitrumTokenStrategy(
      mock<PayoutArbitrumService>(),
      mock<AssetService>(),
      mock<PayoutOrderRepository>(),
    );
    bscCoin = new BscCoinStrategy(mock<PayoutBscService>(), mock<AssetService>(), mock<PayoutOrderRepository>());
    bscToken = new BscTokenStrategy(mock<PayoutBscService>(), mock<AssetService>(), mock<PayoutOrderRepository>());

    ethereumCoin = new EthereumCoinStrategy(
      mock<PayoutEthereumService>(),
      mock<AssetService>(),
      mock<PayoutOrderRepository>(),
    );
    ethereumToken = new EthereumTokenStrategy(
      mock<PayoutEthereumService>(),
      mock<AssetService>(),
      mock<PayoutOrderRepository>(),
    );
    optimismCoin = new OptimismCoinStrategy(
      mock<PayoutOptimismService>(),
      mock<AssetService>(),
      mock<PayoutOrderRepository>(),
    );
    optimismToken = new OptimismTokenStrategy(
      mock<PayoutOptimismService>(),
      mock<AssetService>(),
      mock<PayoutOrderRepository>(),
    );
    polygonCoin = new PolygonCoinStrategy(
      mock<PayoutPolygonService>(),
      mock<AssetService>(),
      mock<PayoutOrderRepository>(),
    );
    polygonToken = new PolygonTokenStrategy(
      mock<PayoutPolygonService>(),
      mock<AssetService>(),
      mock<PayoutOrderRepository>(),
    );
    baseCoin = new BaseCoinStrategy(mock<PayoutBaseService>(), mock<AssetService>(), mock<PayoutOrderRepository>());
    baseToken = new BaseTokenStrategy(mock<PayoutBaseService>(), mock<AssetService>(), mock<PayoutOrderRepository>());
    gnosisCoin = new GnosisCoinStrategy(
      mock<PayoutGnosisService>(),
      mock<AssetService>(),
      mock<PayoutOrderRepository>(),
    );
    gnosisToken = new GnosisTokenStrategy(
      mock<PayoutGnosisService>(),
      mock<AssetService>(),
      mock<PayoutOrderRepository>(),
    );
    solanaCoin = new SolanaCoinStrategy(
      mock<PayoutSolanaService>(),
      mock<AssetService>(),
      mock<PayoutOrderRepository>(),
    );
    solanaToken = new SolanaTokenStrategy(
      mock<PayoutSolanaService>(),
      mock<AssetService>(),
      mock<PayoutOrderRepository>(),
    );
    tronCoin = new TronCoinStrategy(mock<PayoutTronService>(), mock<AssetService>(), mock<PayoutOrderRepository>());
    tronToken = new TronTokenStrategy(mock<PayoutTronService>(), mock<AssetService>(), mock<PayoutOrderRepository>());

    registry = new PayoutStrategyRegistryWrapper(
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

  describe('#getPayoutStrategy(...)', () => {
    describe('getting strategy by Asset', () => {
      it('gets BITCOIN strategy for BITCOIN', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.BITCOIN, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(BitcoinStrategy);
      });

      it('gets LIGHTNING strategy for LIGHTNING', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.LIGHTNING, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(LightningStrategy);
      });

      it('gets MONERO strategy for MONERO', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.MONERO, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(MoneroStrategy);
      });

      it('gets ZANO_COIN strategy', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.ZANO, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(ZanoCoinStrategy);
      });

      it('gets ZANO_TOKEN strategy', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.ZANO, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(ZanoTokenStrategy);
      });

      it('gets ARBITRUM_COIN strategy', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.ARBITRUM, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(ArbitrumCoinStrategy);
      });

      it('gets ARBITRUM_TOKEN strategy', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.ARBITRUM, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(ArbitrumTokenStrategy);
      });

      it('gets BSC_COIN strategy', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(BscCoinStrategy);
      });

      it('gets BSC_TOKEN strategy', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(BscTokenStrategy);
      });

      it('gets ETHEREUM_COIN strategy', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.ETHEREUM, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(EthereumCoinStrategy);
      });

      it('gets ETHEREUM_TOKEN strategy', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.ETHEREUM, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(EthereumTokenStrategy);
      });

      it('gets OPTIMISM_COIN strategy', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.OPTIMISM, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(OptimismCoinStrategy);
      });

      it('gets OPTIMISM_TOKEN strategy', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.OPTIMISM, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(OptimismTokenStrategy);
      });

      it('gets POLYGON_COIN strategy', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.POLYGON, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(PolygonCoinStrategy);
      });

      it('gets POLYGON_TOKEN strategy', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.POLYGON, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(PolygonTokenStrategy);
      });

      it('gets BASE_COIN strategy', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.BASE, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(BaseCoinStrategy);
      });

      it('gets BASE_TOKEN strategy', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.BASE, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(BaseTokenStrategy);
      });

      it('gets GNOSIS_COIN strategy', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.GNOSIS, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(GnosisCoinStrategy);
      });

      it('gets GNOSIS_TOKEN strategy', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.GNOSIS, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(GnosisTokenStrategy);
      });

      it('gets SOLANA_COIN strategy', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.SOLANA, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(SolanaCoinStrategy);
      });

      it('gets SOLANA_TOKEN strategy', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.SOLANA, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(SolanaTokenStrategy);
      });

      it('gets TRON_COIN strategy', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.TRON, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(TronCoinStrategy);
      });

      it('gets TRON_TOKEN strategy', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.TRON, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(TronTokenStrategy);
      });

      it('fails to get strategy for non-supported Blockchain', () => {
        const testCall = () =>
          registry.getPayoutStrategy(
            createCustomAsset({ blockchain: 'NewBlockchain' as Blockchain, type: 'NewType' as AssetType }),
          );

        expect(testCall).toThrow();
        expect(testCall).toThrowError('No PayoutStrategy found. Blockchain: NewBlockchain, AssetType: NewType');
      });
    });
  });
});

class PayoutStrategyRegistryWrapper extends PayoutStrategyRegistry {
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

    this.add({ blockchain: Blockchain.BITCOIN, assetType: AssetType.COIN }, bitcoin);
    this.add({ blockchain: Blockchain.LIGHTNING, assetType: AssetType.COIN }, lightning);
    this.add({ blockchain: Blockchain.MONERO, assetType: AssetType.COIN }, monero);
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
