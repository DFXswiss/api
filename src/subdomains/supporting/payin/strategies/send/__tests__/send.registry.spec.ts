import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInArbitrumService } from '../../../services/payin-arbitrum.service';
import { PayInBitcoinService } from '../../../services/payin-bitcoin.service';
import { PayInBscService } from '../../../services/payin-bsc.service';
import { PayInDeFiChainService } from '../../../services/payin-defichain.service';
import { PayInEthereumService } from '../../../services/payin-ethereum.service';
import { PayInOptimismService } from '../../../services/payin-optimism.service';
import { ArbitrumCoinStrategy } from '../impl/arbitrum-coin.strategy';
import { ArbitrumTokenStrategy } from '../impl/arbitrum-token.strategy';
import { SendStrategyRegistry } from '../impl/base/send.strategy-registry';
import { BitcoinStrategy } from '../impl/bitcoin.strategy';
import { BscCoinStrategy } from '../impl/bsc-coin.strategy';
import { BscTokenStrategy } from '../impl/bsc-token.strategy';
import { DeFiChainCoinStrategy } from '../impl/defichain-coin.strategy';
import { DeFiChainTokenStrategy } from '../impl/defichain-token.strategy';
import { EthereumCoinStrategy } from '../impl/ethereum-coin.strategy';
import { EthereumTokenStrategy } from '../impl/ethereum-token.strategy';
import { LightningStrategy } from '../impl/lightning.strategy';
import { OptimismCoinStrategy } from '../impl/optimism-coin.strategy';
import { OptimismTokenStrategy } from '../impl/optimism-token.strategy';

describe('SendStrategyRegistry', () => {
  let bitcoin: BitcoinStrategy;
  let lightning: LightningStrategy;
  let deFiChainCoin: DeFiChainCoinStrategy;
  let deFiChainToken: DeFiChainTokenStrategy;
  let ethereumCoin: EthereumCoinStrategy;
  let ethereumToken: EthereumTokenStrategy;
  let bscCoin: BscCoinStrategy;
  let bscToken: BscTokenStrategy;
  let arbitrumCoin: ArbitrumCoinStrategy;
  let arbitrumToken: ArbitrumTokenStrategy;
  let optimismCoin: OptimismCoinStrategy;
  let optimismToken: OptimismTokenStrategy;

  let registry: SendStrategyRegistryWrapper;

  beforeEach(() => {
    bitcoin = new BitcoinStrategy(mock<PayInBitcoinService>(), mock<PayInRepository>());

    lightning = new LightningStrategy(mock<PayInRepository>());

    deFiChainCoin = new DeFiChainCoinStrategy(mock<PayInDeFiChainService>(), mock<PayInRepository>());
    deFiChainToken = new DeFiChainTokenStrategy(mock<PayInDeFiChainService>(), mock<PayInRepository>());

    ethereumCoin = new EthereumCoinStrategy(mock<PayInEthereumService>(), mock<PayInRepository>());
    ethereumToken = new EthereumTokenStrategy(mock<PayInEthereumService>(), mock<PayInRepository>());

    bscCoin = new BscCoinStrategy(mock<PayInBscService>(), mock<PayInRepository>());
    bscToken = new BscTokenStrategy(mock<PayInBscService>(), mock<PayInRepository>());

    arbitrumCoin = new ArbitrumCoinStrategy(mock<PayInArbitrumService>(), mock<PayInRepository>());
    arbitrumToken = new ArbitrumTokenStrategy(mock<PayInArbitrumService>(), mock<PayInRepository>());

    optimismCoin = new OptimismCoinStrategy(mock<PayInOptimismService>(), mock<PayInRepository>());
    optimismToken = new OptimismTokenStrategy(mock<PayInOptimismService>(), mock<PayInRepository>());

    registry = new SendStrategyRegistryWrapper(
      bitcoin,
      lightning,
      deFiChainCoin,
      deFiChainToken,
      ethereumCoin,
      ethereumToken,
      bscCoin,
      bscToken,
      arbitrumCoin,
      arbitrumToken,
      optimismCoin,
      optimismToken,
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

      it('gets DEFICHAIN_COIN strategy', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(DeFiChainCoinStrategy);
      });

      it('gets DEFICHAIN_TOKEN strategy for DEFICHAIN', () => {
        const strategy = registry.getSendStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(DeFiChainTokenStrategy);
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
    deFiChainCoin: DeFiChainCoinStrategy,
    deFiChainToken: DeFiChainTokenStrategy,
    ethereumCoin: EthereumCoinStrategy,
    ethereumToken: EthereumTokenStrategy,
    bscCoin: BscCoinStrategy,
    bscToken: BscTokenStrategy,
    arbitrumCoin: ArbitrumCoinStrategy,
    arbitrumToken: ArbitrumTokenStrategy,
    optimismCoin: OptimismCoinStrategy,
    optimismToken: OptimismTokenStrategy,
  ) {
    super();

    this.addStrategy({ blockchain: Blockchain.BITCOIN }, bitcoin);
    this.addStrategy({ blockchain: Blockchain.LIGHTNING }, lightning);

    this.addStrategy({ blockchain: Blockchain.DEFICHAIN, assetType: AssetType.COIN }, deFiChainCoin);
    this.addStrategy({ blockchain: Blockchain.DEFICHAIN, assetType: AssetType.TOKEN }, deFiChainToken);
    this.addStrategy({ blockchain: Blockchain.ETHEREUM, assetType: AssetType.COIN }, ethereumCoin);
    this.addStrategy({ blockchain: Blockchain.ETHEREUM, assetType: AssetType.TOKEN }, ethereumToken);
    this.addStrategy({ blockchain: Blockchain.BINANCE_SMART_CHAIN, assetType: AssetType.COIN }, bscCoin);
    this.addStrategy({ blockchain: Blockchain.BINANCE_SMART_CHAIN, assetType: AssetType.TOKEN }, bscToken);
    this.addStrategy({ blockchain: Blockchain.ARBITRUM, assetType: AssetType.COIN }, arbitrumCoin);
    this.addStrategy({ blockchain: Blockchain.ARBITRUM, assetType: AssetType.TOKEN }, arbitrumToken);
    this.addStrategy({ blockchain: Blockchain.OPTIMISM, assetType: AssetType.COIN }, optimismCoin);
    this.addStrategy({ blockchain: Blockchain.OPTIMISM, assetType: AssetType.TOKEN }, optimismToken);
  }
}
