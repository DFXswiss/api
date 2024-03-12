import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
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
    bitcoinStrategy = new BitcoinStrategy(mock<PayInBitcoinService>());

    lightningStrategy = new LightningStrategy(mock<LightningService>());

    moneroStrategy = new MoneroStrategy(mock<PayInMoneroService>());

    ethereumStrategy = new EthereumStrategy(mock<PayInEthereumService>());

    bscStrategy = new BscStrategy(mock<PayInBscService>());

    arbitrumStrategy = new ArbitrumStrategy(mock<PayInArbitrumService>());

    optimismStrategy = new OptimismStrategy(mock<PayInOptimismService>());

    polygonStrategy = new PolygonStrategy(mock<PayInPolygonService>());

    baseStrategy = new BaseStrategy(mock<PayInBaseService>());

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

    this.add(Blockchain.BITCOIN, bitcoinStrategy);
    this.add(Blockchain.LIGHTNING, lightningStrategy);
    this.add(Blockchain.MONERO, moneroStrategy);
    this.add(Blockchain.ETHEREUM, ethereumStrategy);
    this.add(Blockchain.BINANCE_SMART_CHAIN, bscStrategy);
    this.add(Blockchain.ARBITRUM, arbitrumStrategy);
    this.add(Blockchain.OPTIMISM, optimismStrategy);
    this.add(Blockchain.POLYGON, polygonStrategy);
    this.add(Blockchain.BASE, baseStrategy);
  }
}
