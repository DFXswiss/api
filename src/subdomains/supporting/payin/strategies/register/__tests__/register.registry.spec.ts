import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInArbitrumService } from '../../../services/payin-arbitrum.service';
import { PayInBaseService } from '../../../services/payin-base.service';
import { PayInBitcoinService } from '../../../services/payin-bitcoin.service';
import { PayInBscService } from '../../../services/payin-bsc.service';
import { PayInEthereumService } from '../../../services/payin-ethereum.service';
import { PayInMoneroService } from '../../../services/payin-monero.service';
import { PayInOptimismService } from '../../../services/payin-optimism.service';
import { PayInPolygonService } from '../../../services/payin-polygon.service';
import { ArbitrumStrategy } from '../impl/arbitrum.strategy';
import { BaseStrategy } from '../impl/base.strategy';
import { RegisterStrategyRegistry } from '../impl/base/register.strategy-registry';
import { BitcoinStrategy } from '../impl/bitcoin.strategy';
import { BscStrategy } from '../impl/bsc.strategy';
import { EthereumStrategy } from '../impl/ethereum.strategy';
import { LightningStrategy } from '../impl/lightning.strategy';
import { MoneroStrategy } from '../impl/monero.strategy';
import { OptimismStrategy } from '../impl/optimism.strategy';
import { PolygonStrategy } from '../impl/polygon.strategy';

describe('RegisterStrategyRegistry', () => {
  let bitcoinStrategy: BitcoinStrategy;
  let lightningStrategy: LightningStrategy;
  let moneroStrategy: MoneroStrategy;
  let ethereumStrategy: EthereumStrategy;
  let bscStrategy: BscStrategy;
  let arbitrumStrategy: ArbitrumStrategy;
  let optimismStrategy: OptimismStrategy;
  let polygonStrategy: PolygonStrategy;
  let baseStrategy: BaseStrategy;

  let registry: RegisterStrategyRegistryWrapper;

  beforeEach(() => {
    bitcoinStrategy = new BitcoinStrategy(mock<AssetService>(), mock<PayInBitcoinService>(), mock<PayInRepository>());

    lightningStrategy = new LightningStrategy(mock<LightningService>(), mock<AssetService>(), mock<PayInRepository>());

    moneroStrategy = new MoneroStrategy(mock<AssetService>(), mock<PayInMoneroService>(), mock<PayInRepository>());

    ethereumStrategy = new EthereumStrategy(
      mock<PayInEthereumService>(),
      mock<PayInRepository>(),
      mock<AssetService>(),
      mock<RepositoryFactory>(),
    );

    bscStrategy = new BscStrategy(
      mock<PayInBscService>(),
      mock<PayInRepository>(),
      mock<AssetService>(),
      mock<RepositoryFactory>(),
    );

    arbitrumStrategy = new ArbitrumStrategy(
      mock<PayInArbitrumService>(),
      mock<PayInRepository>(),
      mock<AssetService>(),
      mock<RepositoryFactory>(),
    );

    optimismStrategy = new OptimismStrategy(
      mock<PayInOptimismService>(),
      mock<PayInRepository>(),
      mock<AssetService>(),
      mock<RepositoryFactory>(),
    );

    polygonStrategy = new PolygonStrategy(
      mock<PayInPolygonService>(),
      mock<PayInRepository>(),
      mock<AssetService>(),
      mock<RepositoryFactory>(),
    );

    baseStrategy = new BaseStrategy(
      mock<PayInBaseService>(),
      mock<PayInRepository>(),
      mock<AssetService>(),
      mock<RepositoryFactory>(),
    );

    registry = new RegisterStrategyRegistryWrapper(
      bitcoinStrategy,
      lightningStrategy,
      moneroStrategy,
      ethereumStrategy,
      bscStrategy,
      arbitrumStrategy,
      optimismStrategy,
      polygonStrategy,
      baseStrategy,
    );
  });

  describe('#getPrepareStrategy(...)', () => {
    describe('getting strategy by Asset', () => {
      it('gets BITCOIN strategy for BITCOIN', () => {
        const strategy = registry.getRegisterStrategy(createCustomAsset({ blockchain: Blockchain.BITCOIN }));

        expect(strategy).toBeInstanceOf(BitcoinStrategy);
      });

      it('gets LIGHTNING strategy for LIGHTNING', () => {
        const strategy = registry.getRegisterStrategy(createCustomAsset({ blockchain: Blockchain.LIGHTNING }));

        expect(strategy).toBeInstanceOf(LightningStrategy);
      });

      it('gets MONERO strategy for MONERO', () => {
        const strategy = registry.getRegisterStrategy(createCustomAsset({ blockchain: Blockchain.MONERO }));

        expect(strategy).toBeInstanceOf(MoneroStrategy);
      });

      it('gets ETHEREUM strategy for ETHERUM', () => {
        const strategy = registry.getRegisterStrategy(createCustomAsset({ blockchain: Blockchain.ETHEREUM }));

        expect(strategy).toBeInstanceOf(EthereumStrategy);
      });

      it('gets BSC strategy FOR BINANCE_SMART_CHAIN', () => {
        const strategy = registry.getRegisterStrategy(
          createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN }),
        );

        expect(strategy).toBeInstanceOf(BscStrategy);
      });

      it('gets ARBITRUM strategy for ARBITRUM', () => {
        const strategy = registry.getRegisterStrategy(createCustomAsset({ blockchain: Blockchain.ARBITRUM }));

        expect(strategy).toBeInstanceOf(ArbitrumStrategy);
      });

      it('gets OPTIMISM strategy for OPTIMISM', () => {
        const strategy = registry.getRegisterStrategy(createCustomAsset({ blockchain: Blockchain.OPTIMISM }));

        expect(strategy).toBeInstanceOf(OptimismStrategy);
      });

      it('gets POLYGON strategy for POLYGON', () => {
        const strategy = registry.getRegisterStrategy(createCustomAsset({ blockchain: Blockchain.POLYGON }));

        expect(strategy).toBeInstanceOf(PolygonStrategy);
      });

      it('gets BASE strategy for BASE', () => {
        const strategy = registry.getRegisterStrategy(createCustomAsset({ blockchain: Blockchain.BASE }));

        expect(strategy).toBeInstanceOf(BaseStrategy);
      });

      it('fails to get strategy for non-supported Blockchain', () => {
        const testCall = () =>
          registry.getRegisterStrategy(createCustomAsset({ blockchain: 'NewBlockchain' as Blockchain }));

        expect(testCall).toThrow();
        expect(testCall).toThrowError('No RegisterStrategy found. Blockchain: NewBlockchain');
      });
    });
  });
});

class RegisterStrategyRegistryWrapper extends RegisterStrategyRegistry {
  constructor(
    bitcoinStrategy: BitcoinStrategy,
    lightningStrategy: LightningStrategy,
    moneroStrategy: MoneroStrategy,
    ethereumStrategy: EthereumStrategy,
    bscStrategy: BscStrategy,
    arbitrumStrategy: ArbitrumStrategy,
    optimismStrategy: OptimismStrategy,
    polygonStrategy: PolygonStrategy,
    baseStrategy: BaseStrategy,
  ) {
    super();

    this.addStrategy(Blockchain.BITCOIN, bitcoinStrategy);
    this.addStrategy(Blockchain.LIGHTNING, lightningStrategy);
    this.addStrategy(Blockchain.MONERO, moneroStrategy);
    this.addStrategy(Blockchain.ETHEREUM, ethereumStrategy);
    this.addStrategy(Blockchain.BINANCE_SMART_CHAIN, bscStrategy);
    this.addStrategy(Blockchain.ARBITRUM, arbitrumStrategy);
    this.addStrategy(Blockchain.OPTIMISM, optimismStrategy);
    this.addStrategy(Blockchain.POLYGON, polygonStrategy);
    this.addStrategy(Blockchain.BASE, baseStrategy);
  }
}
