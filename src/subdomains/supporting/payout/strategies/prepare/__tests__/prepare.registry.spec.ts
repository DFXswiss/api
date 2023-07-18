import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutDeFiChainService } from '../../../services/payout-defichain.service';
import { ArbitrumStrategy } from '../impl/arbitrum.strategy';
import { PrepareStrategyRegistry } from '../impl/base/prepare.strategy-registry';
import { BitcoinStrategy } from '../impl/bitcoin.strategy';
import { BscStrategy } from '../impl/bsc.strategy';
import { DeFiChainStrategy } from '../impl/defichain.strategy';
import { EthereumStrategy } from '../impl/ethereum.strategy';
import { LightningStrategy } from '../impl/lightning.strategy';
import { OptimismStrategy } from '../impl/optimism.strategy';

describe('PrepareStrategyRegistry', () => {
  let bitcoinStrategy: BitcoinStrategy;
  let lightningStrategy: LightningStrategy;
  let defichainStrategy: DeFiChainStrategy;
  let ethereumStrategy: EthereumStrategy;
  let bscStrategy: BscStrategy;
  let arbitrumStrategy: ArbitrumStrategy;
  let optimismStrategy: OptimismStrategy;

  let registry: PrepareStrategyRegistryWrapper;

  beforeEach(() => {
    bitcoinStrategy = new BitcoinStrategy(mock<AssetService>(), mock<PayoutOrderRepository>());
    defichainStrategy = new DeFiChainStrategy(
      mock<AssetService>(),
      mock<DexService>(),
      mock<PayoutDeFiChainService>(),
      mock<PayoutOrderRepository>(),
    );
    lightningStrategy = new LightningStrategy(mock<AssetService>(), mock<PayoutOrderRepository>());
    ethereumStrategy = new EthereumStrategy(mock<AssetService>(), mock<PayoutOrderRepository>());
    bscStrategy = new BscStrategy(mock<AssetService>(), mock<PayoutOrderRepository>());
    arbitrumStrategy = new ArbitrumStrategy(mock<AssetService>(), mock<PayoutOrderRepository>());
    optimismStrategy = new OptimismStrategy(mock<AssetService>(), mock<PayoutOrderRepository>());

    registry = new PrepareStrategyRegistryWrapper(
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
        const strategy = registry.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.BITCOIN }));

        expect(strategy).toBeInstanceOf(BitcoinStrategy);
      });

      it('gets LIGHTNING strategy for LIGHTNING', () => {
        const strategy = registry.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.LIGHTNING }));

        expect(strategy).toBeInstanceOf(LightningStrategy);
      });

      it('gets ETHEREUM strategy for ETHERUM', () => {
        const strategy = registry.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.ETHEREUM }));

        expect(strategy).toBeInstanceOf(EthereumStrategy);
      });

      it('gets BSC strategy FOR BINANCE_SMART_CHAIN', () => {
        const strategy = registry.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN }));

        expect(strategy).toBeInstanceOf(BscStrategy);
      });

      it('gets DEFICHAIN strategy for DEFICHAIN', () => {
        const strategy = registry.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.DEFICHAIN }));

        expect(strategy).toBeInstanceOf(DeFiChainStrategy);
      });

      it('gets ARBITRUM strategy for ARBITRUM', () => {
        const strategy = registry.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.ARBITRUM }));

        expect(strategy).toBeInstanceOf(ArbitrumStrategy);
      });

      it('gets OPTIMISM strategy for OPTIMISM', () => {
        const strategy = registry.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.OPTIMISM }));

        expect(strategy).toBeInstanceOf(OptimismStrategy);
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
    defichainStrategy: DeFiChainStrategy,
    ethereumStrategy: EthereumStrategy,
    bscStrategy: BscStrategy,
    arbitrumStrategy: ArbitrumStrategy,
    optimismStrategy: OptimismStrategy,
  ) {
    super();

    this.add(Blockchain.BITCOIN, bitcoinStrategy);
    this.add(Blockchain.LIGHTNING, lightningStrategy);
    this.add(Blockchain.DEFICHAIN, defichainStrategy);
    this.add(Blockchain.ETHEREUM, ethereumStrategy);
    this.add(Blockchain.BINANCE_SMART_CHAIN, bscStrategy);
    this.add(Blockchain.ARBITRUM, arbitrumStrategy);
    this.add(Blockchain.OPTIMISM, optimismStrategy);
  }
}
