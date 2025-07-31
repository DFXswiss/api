import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { ArbitrumStrategy } from '../impl/arbitrum.strategy';
import { BaseStrategy } from '../impl/base.strategy';
import { PrepareStrategyRegistry } from '../impl/base/prepare.strategy-registry';
import { BitcoinStrategy } from '../impl/bitcoin.strategy';
import { BscStrategy } from '../impl/bsc.strategy';
import { EthereumStrategy } from '../impl/ethereum.strategy';
import { GnosisStrategy } from '../impl/gnosis.strategy';
import { LightningStrategy } from '../impl/lightning.strategy';
import { MoneroStrategy } from '../impl/monero.strategy';
import { OptimismStrategy } from '../impl/optimism.strategy';
import { PolygonStrategy } from '../impl/polygon.strategy';
import { SolanaStrategy } from '../impl/solana.strategy';
import { TronStrategy } from '../impl/tron.strategy';
import { ZanoStrategy } from '../impl/zano.strategy';

describe('PrepareStrategyRegistry', () => {
  let bitcoinStrategy: BitcoinStrategy;
  let lightningStrategy: LightningStrategy;
  let moneroStrategy: MoneroStrategy;
  let zanoStrategy: ZanoStrategy;
  let ethereumStrategy: EthereumStrategy;
  let bscStrategy: BscStrategy;
  let arbitrumStrategy: ArbitrumStrategy;
  let optimismStrategy: OptimismStrategy;
  let polygonStrategy: PolygonStrategy;
  let baseStrategy: BaseStrategy;
  let gnosisStrategy: GnosisStrategy;
  let solanaStrategy: SolanaStrategy;
  let tronStrategy: TronStrategy;

  let registry: PrepareStrategyRegistryWrapper;

  beforeEach(() => {
    bitcoinStrategy = new BitcoinStrategy(mock<AssetService>(), mock<PayoutOrderRepository>());
    lightningStrategy = new LightningStrategy(mock<AssetService>(), mock<PayoutOrderRepository>());
    moneroStrategy = new MoneroStrategy(mock<AssetService>(), mock<PayoutOrderRepository>());
    zanoStrategy = new ZanoStrategy(mock<AssetService>(), mock<PayoutOrderRepository>());

    ethereumStrategy = new EthereumStrategy(mock<AssetService>(), mock<PayoutOrderRepository>());
    bscStrategy = new BscStrategy(mock<AssetService>(), mock<PayoutOrderRepository>());
    arbitrumStrategy = new ArbitrumStrategy(mock<AssetService>(), mock<PayoutOrderRepository>());
    optimismStrategy = new OptimismStrategy(mock<AssetService>(), mock<PayoutOrderRepository>());
    polygonStrategy = new PolygonStrategy(mock<AssetService>(), mock<PayoutOrderRepository>());
    baseStrategy = new BaseStrategy(mock<AssetService>(), mock<PayoutOrderRepository>());
    gnosisStrategy = new GnosisStrategy(mock<AssetService>(), mock<PayoutOrderRepository>());
    solanaStrategy = new SolanaStrategy(mock<AssetService>(), mock<PayoutOrderRepository>());
    tronStrategy = new TronStrategy(mock<AssetService>(), mock<PayoutOrderRepository>());

    registry = new PrepareStrategyRegistryWrapper(
      bitcoinStrategy,
      lightningStrategy,
      moneroStrategy,
      zanoStrategy,
      ethereumStrategy,
      bscStrategy,
      arbitrumStrategy,
      optimismStrategy,
      polygonStrategy,
      baseStrategy,
      gnosisStrategy,
      solanaStrategy,
      tronStrategy,
    );
  });

  describe('#getPrepareStrategy(...)', () => {
    describe('getting strategy by Asset', () => {
      it('gets BITCOIN strategy for BITCOIN', () => {
        const strategy = registry.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.BITCOIN }));

        expect(strategy).toBeInstanceOf(BitcoinStrategy);
      });

      it('gets LIGHTNING strategy for LIGHTNING', () => {
        const strategy = registry.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.LIGHTNING }));

        expect(strategy).toBeInstanceOf(LightningStrategy);
      });

      it('gets MONERO strategy for MONERO', () => {
        const strategy = registry.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.MONERO }));

        expect(strategy).toBeInstanceOf(MoneroStrategy);
      });

      it('gets ZANO strategy for ZANO', () => {
        const strategy = registry.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.ZANO }));

        expect(strategy).toBeInstanceOf(ZanoStrategy);
      });

      it('gets ETHEREUM strategy for ETHERUM', () => {
        const strategy = registry.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.ETHEREUM }));

        expect(strategy).toBeInstanceOf(EthereumStrategy);
      });

      it('gets BSC strategy FOR BINANCE_SMART_CHAIN', () => {
        const strategy = registry.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN }));

        expect(strategy).toBeInstanceOf(BscStrategy);
      });

      it('gets ARBITRUM strategy for ARBITRUM', () => {
        const strategy = registry.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.ARBITRUM }));

        expect(strategy).toBeInstanceOf(ArbitrumStrategy);
      });

      it('gets OPTIMISM strategy for OPTIMISM', () => {
        const strategy = registry.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.OPTIMISM }));

        expect(strategy).toBeInstanceOf(OptimismStrategy);
      });

      it('gets POLYGON strategy for POLYGON', () => {
        const strategy = registry.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.POLYGON }));

        expect(strategy).toBeInstanceOf(PolygonStrategy);
      });

      it('gets BASE strategy for BASE', () => {
        const strategy = registry.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.BASE }));

        expect(strategy).toBeInstanceOf(BaseStrategy);
      });

      it('gets GNOSIS strategy for GNOSIS', () => {
        const strategy = registry.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.GNOSIS }));

        expect(strategy).toBeInstanceOf(GnosisStrategy);
      });

      it('gets SOLANA strategy for SOLANA', () => {
        const strategy = registry.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.SOLANA }));

        expect(strategy).toBeInstanceOf(SolanaStrategy);
      });

      it('gets TRON strategy for TRON', () => {
        const strategy = registry.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.TRON }));

        expect(strategy).toBeInstanceOf(TronStrategy);
      });

      it('fails to get strategy for non-supported Blockchain', () => {
        const testCall = () =>
          registry.getPrepareStrategy(createCustomAsset({ blockchain: 'NewBlockchain' as Blockchain }));

        expect(testCall).toThrow();
        expect(testCall).toThrowError('No PrepareStrategy found. Blockchain: NewBlockchain');
      });
    });
  });
});

class PrepareStrategyRegistryWrapper extends PrepareStrategyRegistry {
  constructor(
    bitcoinStrategy: BitcoinStrategy,
    lightningStrategy: LightningStrategy,
    moneroStrategy: MoneroStrategy,
    zanoStrategy: ZanoStrategy,
    ethereumStrategy: EthereumStrategy,
    bscStrategy: BscStrategy,
    arbitrumStrategy: ArbitrumStrategy,
    optimismStrategy: OptimismStrategy,
    polygonStrategy: PolygonStrategy,
    baseStrategy: BaseStrategy,
    gnosisStrategy: GnosisStrategy,
    solanaStrategy: SolanaStrategy,
    tronStrategy: TronStrategy,
  ) {
    super();

    this.add(Blockchain.BITCOIN, bitcoinStrategy);
    this.add(Blockchain.LIGHTNING, lightningStrategy);
    this.add(Blockchain.MONERO, moneroStrategy);
    this.add(Blockchain.ZANO, zanoStrategy);

    this.add(Blockchain.ETHEREUM, ethereumStrategy);
    this.add(Blockchain.BINANCE_SMART_CHAIN, bscStrategy);
    this.add(Blockchain.ARBITRUM, arbitrumStrategy);
    this.add(Blockchain.OPTIMISM, optimismStrategy);
    this.add(Blockchain.POLYGON, polygonStrategy);
    this.add(Blockchain.BASE, baseStrategy);
    this.add(Blockchain.GNOSIS, gnosisStrategy);
    this.add(Blockchain.SOLANA, solanaStrategy);
    this.add(Blockchain.TRON, tronStrategy);
  }
}
