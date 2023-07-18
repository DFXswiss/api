import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutArbitrumService } from '../../../services/payout-arbitrum.service';
import { PayoutBitcoinService } from '../../../services/payout-bitcoin.service';
import { PayoutBscService } from '../../../services/payout-bsc.service';
import { PayoutDeFiChainService } from '../../../services/payout-defichain.service';
import { PayoutEthereumService } from '../../../services/payout-ethereum.service';
import { PayoutOptimismService } from '../../../services/payout-optimism.service';
import { ArbitrumCoinStrategy } from '../impl/arbitrum-coin.strategy';
import { ArbitrumTokenStrategy } from '../impl/arbitrum-token.strategy';
import { PayoutStrategyRegistry } from '../impl/base/payout.strategy-registry';
import { BitcoinStrategy } from '../impl/bitcoin.strategy';
import { BscCoinStrategy } from '../impl/bsc-coin.strategy';
import { BscTokenStrategy } from '../impl/bsc-token.strategy';
import { DeFiChainCoinStrategy } from '../impl/defichain-coin.strategy';
import { DeFiChainTokenStrategy } from '../impl/defichain-token.strategy';
import { EthereumCoinStrategy } from '../impl/ethereum-coin.strategy';
import { EthereumTokenStrategy } from '../impl/ethereum-token.strategy';
import { OptimismCoinStrategy } from '../impl/optimism-coin.strategy';
import { OptimismTokenStrategy } from '../impl/optimism-token.strategy';

describe('PayoutStrategyRegistry', () => {
  let arbitrumCoin: ArbitrumCoinStrategy;
  let arbitrumToken: ArbitrumTokenStrategy;
  let bitcoin: BitcoinStrategy;
  let deFiChainCoin: DeFiChainCoinStrategy;
  let deFiChainToken: DeFiChainTokenStrategy;
  let ethereumCoin: EthereumCoinStrategy;
  let ethereumToken: EthereumTokenStrategy;
  let bscCoin: BscCoinStrategy;
  let bscToken: BscTokenStrategy;
  let optimismCoin: OptimismCoinStrategy;
  let optimismToken: OptimismTokenStrategy;

  let registry: PayoutStrategyRegistryWrapper;

  beforeEach(() => {
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
    bitcoin = new BitcoinStrategy(
      mock<NotificationService>(),
      mock<PayoutBitcoinService>(),
      mock<PayoutOrderRepository>(),
      mock<AssetService>(),
    );
    deFiChainCoin = new DeFiChainCoinStrategy(
      mock<NotificationService>(),
      mock<PayoutDeFiChainService>(),
      mock<PayoutOrderRepository>(),
      mock<AssetService>(),
    );
    deFiChainToken = new DeFiChainTokenStrategy(
      mock<NotificationService>(),
      mock<DexService>(),
      mock<PayoutDeFiChainService>(),
      mock<PayoutOrderRepository>(),
      mock<AssetService>(),
    );
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
    bscCoin = new BscCoinStrategy(mock<PayoutBscService>(), mock<AssetService>(), mock<PayoutOrderRepository>());
    bscToken = new BscTokenStrategy(mock<PayoutBscService>(), mock<AssetService>(), mock<PayoutOrderRepository>());
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

    registry = new PayoutStrategyRegistryWrapper(
      arbitrumCoin,
      arbitrumToken,
      bitcoin,
      bscCoin,
      bscToken,
      deFiChainCoin,
      deFiChainToken,
      ethereumCoin,
      ethereumToken,
      optimismCoin,
      optimismToken,
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

      it('gets DEFICHAIN_COIN strategy', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(DeFiChainCoinStrategy);
      });

      it('gets DEFICHAIN_TOKEN strategy for DEFICHAIN', () => {
        const strategy = registry.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(DeFiChainTokenStrategy);
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
    arbitrumCoin: ArbitrumCoinStrategy,
    arbitrumToken: ArbitrumTokenStrategy,
    bitcoin: BitcoinStrategy,
    bscCoin: BscCoinStrategy,
    bscToken: BscTokenStrategy,
    deFiChainCoin: DeFiChainCoinStrategy,
    deFiChainToken: DeFiChainTokenStrategy,
    ethereumCoin: EthereumCoinStrategy,
    ethereumToken: EthereumTokenStrategy,
    optimismCoin: OptimismCoinStrategy,
    optimismToken: OptimismTokenStrategy,
  ) {
    super();

    this.add({ blockchain: Blockchain.ARBITRUM, assetType: AssetType.COIN }, arbitrumCoin);
    this.add({ blockchain: Blockchain.ARBITRUM, assetType: AssetType.TOKEN }, arbitrumToken);
    this.add({ blockchain: Blockchain.BITCOIN, assetType: AssetType.COIN }, bitcoin);
    this.add({ blockchain: Blockchain.BINANCE_SMART_CHAIN, assetType: AssetType.COIN }, bscCoin);
    this.add({ blockchain: Blockchain.BINANCE_SMART_CHAIN, assetType: AssetType.TOKEN }, bscToken);
    this.add({ blockchain: Blockchain.DEFICHAIN, assetType: AssetType.COIN }, deFiChainCoin);
    this.add({ blockchain: Blockchain.DEFICHAIN, assetType: AssetType.TOKEN }, deFiChainToken);
    this.add({ blockchain: Blockchain.ETHEREUM, assetType: AssetType.COIN }, ethereumCoin);
    this.add({ blockchain: Blockchain.ETHEREUM, assetType: AssetType.TOKEN }, ethereumToken);
    this.add({ blockchain: Blockchain.OPTIMISM, assetType: AssetType.COIN }, optimismCoin);
    this.add({ blockchain: Blockchain.OPTIMISM, assetType: AssetType.TOKEN }, optimismToken);
  }
}
