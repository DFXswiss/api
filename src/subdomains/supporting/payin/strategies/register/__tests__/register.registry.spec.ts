import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ChainalysisService } from 'src/integration/chainalysis/services/chainalysis.service';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { ProcessService } from 'src/shared/services/process.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInArbitrumService } from '../../../services/payin-arbitrum.service';
import { PayInBitcoinService } from '../../../services/payin-bitcoin.service';
import { PayInBscService } from '../../../services/payin-bsc.service';
import { PayInDeFiChainService } from '../../../services/payin-defichain.service';
import { PayInEthereumService } from '../../../services/payin-ethereum.service';
import { PayInOptimismService } from '../../../services/payin-optimism.service';
import { ArbitrumStrategy } from '../impl/arbitrum.strategy';
import { RegisterStrategyRegistry } from '../impl/base/register.strategy-registry';
import { BitcoinStrategy } from '../impl/bitcoin.strategy';
import { BscStrategy } from '../impl/bsc.strategy';
import { DeFiChainStrategy } from '../impl/defichain.strategy';
import { EthereumStrategy } from '../impl/ethereum.strategy';
import { LightningStrategy } from '../impl/lightning.strategy';
import { OptimismStrategy } from '../impl/optimism.strategy';

describe('RegisterStrategyRegistry', () => {
  let bitcoinStrategy: BitcoinStrategy;
  let lightningStrategy: LightningStrategy;
  let defichainStrategy: DeFiChainStrategy;
  let ethereumStrategy: EthereumStrategy;
  let bscStrategy: BscStrategy;
  let arbitrumStrategy: ArbitrumStrategy;
  let optimismStrategy: OptimismStrategy;

  let registry: RegisterStrategyRegistryWrapper;

  beforeEach(() => {
    bitcoinStrategy = new BitcoinStrategy(
      mock<AssetService>(),
      mock<PayInBitcoinService>(),
      mock<ChainalysisService>(),
      mock<PayInRepository>(),
      mock<ProcessService>(),
    );

    lightningStrategy = new LightningStrategy(
      mock<LightningService>(),
      mock<AssetService>(),
      mock<PayInRepository>(),
      mock<ProcessService>(),
    );

    defichainStrategy = new DeFiChainStrategy(
      mock<AssetService>(),
      mock<PayInDeFiChainService>(),
      mock<PayInRepository>(),
      mock<ProcessService>(),
    );

    ethereumStrategy = new EthereumStrategy(
      mock<PayInEthereumService>(),
      mock<PayInRepository>(),
      mock<AssetService>(),
      mock<RepositoryFactory>(),
      mock<ProcessService>(),
    );

    bscStrategy = new BscStrategy(
      mock<PayInBscService>(),
      mock<PayInRepository>(),
      mock<AssetService>(),
      mock<RepositoryFactory>(),
      mock<ProcessService>(),
    );

    arbitrumStrategy = new ArbitrumStrategy(
      mock<PayInArbitrumService>(),
      mock<PayInRepository>(),
      mock<AssetService>(),
      mock<RepositoryFactory>(),
      mock<ProcessService>(),
    );

    optimismStrategy = new OptimismStrategy(
      mock<PayInOptimismService>(),
      mock<PayInRepository>(),
      mock<AssetService>(),
      mock<RepositoryFactory>(),
      mock<ProcessService>(),
    );

    registry = new RegisterStrategyRegistryWrapper(
      bitcoinStrategy,
      lightningStrategy,
      defichainStrategy,
      ethereumStrategy,
      bscStrategy,
      arbitrumStrategy,
      optimismStrategy,
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

      it('gets DEFICHAIN strategy for DEFICHAIN', () => {
        const strategy = registry.getRegisterStrategy(createCustomAsset({ blockchain: Blockchain.DEFICHAIN }));

        expect(strategy).toBeInstanceOf(DeFiChainStrategy);
      });

      it('gets ARBITRUM strategy for ARBITRUM', () => {
        const strategy = registry.getRegisterStrategy(createCustomAsset({ blockchain: Blockchain.ARBITRUM }));

        expect(strategy).toBeInstanceOf(ArbitrumStrategy);
      });

      it('gets OPTIMISM strategy for OPTIMISM', () => {
        const strategy = registry.getRegisterStrategy(createCustomAsset({ blockchain: Blockchain.OPTIMISM }));

        expect(strategy).toBeInstanceOf(OptimismStrategy);
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
    defichainStrategy: DeFiChainStrategy,
    ethereumStrategy: EthereumStrategy,
    bscStrategy: BscStrategy,
    arbitrumStrategy: ArbitrumStrategy,
    optimismStrategy: OptimismStrategy,
  ) {
    super();

    this.addStrategy(Blockchain.BITCOIN, bitcoinStrategy);
    this.addStrategy(Blockchain.LIGHTNING, lightningStrategy);
    this.addStrategy(Blockchain.DEFICHAIN, defichainStrategy);
    this.addStrategy(Blockchain.ETHEREUM, ethereumStrategy);
    this.addStrategy(Blockchain.BINANCE_SMART_CHAIN, bscStrategy);
    this.addStrategy(Blockchain.ARBITRUM, arbitrumStrategy);
    this.addStrategy(Blockchain.OPTIMISM, optimismStrategy);
  }
}
