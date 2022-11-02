import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutBitcoinService } from '../../../services/payout-bitcoin.service';
import { PayoutBscService } from '../../../services/payout-bsc.service';
import { PayoutDeFiChainService } from '../../../services/payout-defichain.service';
import { PayoutEthereumService } from '../../../services/payout-ethereum.service';
import { BitcoinStrategy } from '../impl/bitcoin.strategy';
import { BscCoinStrategy } from '../impl/bsc-coin.strategy';
import { BscTokenStrategy } from '../impl/bsc-token.strategy';
import { DeFiChainCoinStrategy } from '../impl/defichain-coin.strategy';
import { DeFiChainTokenStrategy } from '../impl/defichain-token.strategy';
import { EthereumCoinStrategy } from '../impl/ethereum-coin.strategy';
import { EthereumTokenStrategy } from '../impl/ethereum-token.strategy';
import { PayoutStrategiesFacade, PayoutStrategyAlias } from '../payout.facade';

describe('PayoutStrategiesFacade', () => {
  let bitcoin: BitcoinStrategy;
  let deFiChainCoin: DeFiChainCoinStrategy;
  let deFiChainToken: DeFiChainTokenStrategy;
  let ethereumCoin: EthereumCoinStrategy;
  let ethereumToken: EthereumTokenStrategy;
  let bscCoin: BscCoinStrategy;
  let bscToken: BscTokenStrategy;

  let facade: PayoutStrategiesFacadeWrapper;

  beforeEach(() => {
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

    facade = new PayoutStrategiesFacadeWrapper(
      bitcoin,
      bscCoin,
      bscToken,
      deFiChainCoin,
      deFiChainToken,
      ethereumCoin,
      ethereumToken,
    );
  });

  describe('#constructor(...)', () => {
    it('adds all payoutStrategies to a map', () => {
      expect([...facade.getStrategies().entries()].length).toBe(7);
    });

    it('assigns strategies to all aliases', () => {
      expect([...facade.getStrategies().entries()].length).toBe(Object.values(PayoutStrategyAlias).length);
    });

    it('sets all required payoutStrategies aliases', () => {
      const aliases = [...facade.getStrategies().keys()];

      expect(aliases.includes(PayoutStrategyAlias.BITCOIN)).toBe(true);
      expect(aliases.includes(PayoutStrategyAlias.BSC_TOKEN)).toBe(true);
      expect(aliases.includes(PayoutStrategyAlias.BSC_COIN)).toBe(true);
      expect(aliases.includes(PayoutStrategyAlias.DEFICHAIN_COIN)).toBe(true);
      expect(aliases.includes(PayoutStrategyAlias.DEFICHAIN_TOKEN)).toBe(true);
      expect(aliases.includes(PayoutStrategyAlias.ETHEREUM_COIN)).toBe(true);
      expect(aliases.includes(PayoutStrategyAlias.ETHEREUM_TOKEN)).toBe(true);
    });

    it('assigns proper payoutStrategies to aliases', () => {
      expect(facade.getStrategies().get(PayoutStrategyAlias.BITCOIN)).toBeInstanceOf(BitcoinStrategy);
      expect(facade.getStrategies().get(PayoutStrategyAlias.BSC_COIN)).toBeInstanceOf(BscCoinStrategy);
      expect(facade.getStrategies().get(PayoutStrategyAlias.BSC_TOKEN)).toBeInstanceOf(BscTokenStrategy);
      expect(facade.getStrategies().get(PayoutStrategyAlias.DEFICHAIN_COIN)).toBeInstanceOf(DeFiChainCoinStrategy);
      expect(facade.getStrategies().get(PayoutStrategyAlias.DEFICHAIN_TOKEN)).toBeInstanceOf(DeFiChainTokenStrategy);
      expect(facade.getStrategies().get(PayoutStrategyAlias.ETHEREUM_COIN)).toBeInstanceOf(EthereumCoinStrategy);
      expect(facade.getStrategies().get(PayoutStrategyAlias.ETHEREUM_TOKEN)).toBeInstanceOf(EthereumTokenStrategy);
    });
  });

  describe('#getPayoutStrategy(...)', () => {
    describe('getting strategy by Asset', () => {
      it('gets BITCOIN strategy for BITCOIN', () => {
        const strategy = facade.getPayoutStrategy(createCustomAsset({ blockchain: Blockchain.BITCOIN }));

        expect(strategy).toBeInstanceOf(BitcoinStrategy);
      });

      it('gets BSC_COIN strategy', () => {
        const strategy = facade.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(BscCoinStrategy);
      });

      it('gets BSC_TOKEN strategy', () => {
        const strategy = facade.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(BscTokenStrategy);
      });

      it('gets DEFICHAIN_COIN strategy', () => {
        const strategy = facade.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(DeFiChainCoinStrategy);
      });

      it('gets DEFICHAIN_TOKEN strategy for DEFICHAIN', () => {
        const strategy = facade.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(DeFiChainTokenStrategy);
      });

      it('gets ETHEREUM_COIN strategy', () => {
        const strategy = facade.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.ETHEREUM, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(EthereumCoinStrategy);
      });

      it('gets ETHEREUM_TOKEN strategy', () => {
        const strategy = facade.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.ETHEREUM, type: AssetType.TOKEN }),
        );

        expect(strategy).toBeInstanceOf(EthereumTokenStrategy);
      });

      it('fails to get strategy for non-supported Blockchain', () => {
        const testCall = () =>
          facade.getPayoutStrategy(createCustomAsset({ blockchain: 'NewBlockchain' as Blockchain }));

        expect(testCall).toThrow();
        expect(testCall).toThrowError('No PayoutStrategy found. Alias: undefined');
      });
    });

    describe('getting strategy by Alias', () => {
      it('gets BITCOIN strategy', () => {
        const strategyCrypto = facade.getPayoutStrategy(PayoutStrategyAlias.BITCOIN);

        expect(strategyCrypto).toBeInstanceOf(BitcoinStrategy);
      });

      it('gets BSC_COIN strategy', () => {
        const strategyCrypto = facade.getPayoutStrategy(PayoutStrategyAlias.BSC_COIN);

        expect(strategyCrypto).toBeInstanceOf(BscCoinStrategy);
      });

      it('gets BSC_TOKEN strategy', () => {
        const strategyCrypto = facade.getPayoutStrategy(PayoutStrategyAlias.BSC_TOKEN);

        expect(strategyCrypto).toBeInstanceOf(BscTokenStrategy);
      });

      it('gets DEFICHAIN_COIN strategy', () => {
        const strategy = facade.getPayoutStrategy(PayoutStrategyAlias.DEFICHAIN_COIN);

        expect(strategy).toBeInstanceOf(DeFiChainCoinStrategy);
      });

      it('gets DEFICHAIN_TOKEN strategy', () => {
        const strategy = facade.getPayoutStrategy(PayoutStrategyAlias.DEFICHAIN_TOKEN);

        expect(strategy).toBeInstanceOf(DeFiChainTokenStrategy);
      });

      it('gets ETHEREUM_COIN strategy', () => {
        const strategy = facade.getPayoutStrategy(PayoutStrategyAlias.ETHEREUM_COIN);

        expect(strategy).toBeInstanceOf(EthereumCoinStrategy);
      });

      it('gets ETHEREUM_TOKEN strategy', () => {
        const strategy = facade.getPayoutStrategy(PayoutStrategyAlias.ETHEREUM_TOKEN);

        expect(strategy).toBeInstanceOf(EthereumTokenStrategy);
      });

      it('fails to get strategy for non-supported Alias', () => {
        const testCall = () => facade.getPayoutStrategy('NonExistingAlias' as PayoutStrategyAlias);

        expect(testCall).toThrow();
        expect(testCall).toThrowError('No PayoutStrategy found. Alias: NonExistingAlias');
      });
    });
  });
});

class PayoutStrategiesFacadeWrapper extends PayoutStrategiesFacade {
  constructor(
    bitcoin: BitcoinStrategy,
    bscCoin: BscCoinStrategy,
    bscToken: BscTokenStrategy,
    deFiChainCoin: DeFiChainCoinStrategy,
    deFiChainToken: DeFiChainTokenStrategy,
    ethereumCoin: EthereumCoinStrategy,
    ethereumToken: EthereumTokenStrategy,
  ) {
    super(bitcoin, bscCoin, bscToken, deFiChainCoin, deFiChainToken, ethereumCoin, ethereumToken);
  }

  getStrategies() {
    return this.strategies;
  }
}
