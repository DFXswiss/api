import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { DexService } from 'src/payment/models/dex/services/dex.service';
import { AssetCategory } from 'src/shared/models/asset/asset.entity';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { MailService } from 'src/shared/services/mail.service';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutBitcoinService } from '../../../services/payout-bitcoin.service';
import { PayoutBscService } from '../../../services/payout-bsc.service';
import { PayoutDeFiChainService } from '../../../services/payout-defichain.service';
import { PayoutEthereumService } from '../../../services/payout-ethereum.service';
import { BitcoinStrategy } from '../impl/bitcoin.strategy';
import { BscCryptoStrategy } from '../impl/bsc-crypto.strategy';
import { BscTokenStrategy } from '../impl/bsc-token.strategy';
import { DeFiChainDfiStrategy } from '../impl/defichain-dfi.strategy';
import { DeFiChainTokenStrategy } from '../impl/defichain-token.strategy';
import { EthereumCryptoStrategy } from '../impl/ethereum-crypto.strategy';
import { EthereumTokenStrategy } from '../impl/ethereum-token.strategy';
import { PayoutStrategiesFacade, PayoutStrategyAlias } from '../payout.facade';

describe('PayoutStrategiesFacade', () => {
  let bitcoin: BitcoinStrategy;
  let deFiChainDfi: DeFiChainDfiStrategy;
  let deFiChainToken: DeFiChainTokenStrategy;
  let ethereumCrypto: EthereumCryptoStrategy;
  let ethereumToken: EthereumTokenStrategy;
  let bscCrypto: BscCryptoStrategy;
  let bscToken: BscTokenStrategy;

  let facade: PayoutStrategiesFacadeWrapper;

  beforeEach(() => {
    bitcoin = new BitcoinStrategy(mock<PayoutBitcoinService>(), mock<PayoutOrderRepository>());
    deFiChainDfi = new DeFiChainDfiStrategy(
      mock<MailService>(),
      mock<PayoutDeFiChainService>(),
      mock<PayoutOrderRepository>(),
    );
    deFiChainToken = new DeFiChainTokenStrategy(
      mock<MailService>(),
      mock<DexService>(),
      mock<PayoutDeFiChainService>(),
      mock<PayoutOrderRepository>(),
    );
    ethereumCrypto = new EthereumCryptoStrategy(mock<PayoutEthereumService>(), mock<PayoutOrderRepository>());
    ethereumToken = new EthereumTokenStrategy(mock<PayoutEthereumService>(), mock<PayoutOrderRepository>());
    bscCrypto = new BscCryptoStrategy(mock<PayoutBscService>(), mock<PayoutOrderRepository>());
    bscToken = new BscTokenStrategy(mock<PayoutBscService>(), mock<PayoutOrderRepository>());

    facade = new PayoutStrategiesFacadeWrapper(
      bitcoin,
      bscCrypto,
      bscToken,
      deFiChainDfi,
      deFiChainToken,
      ethereumCrypto,
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
      expect(aliases.includes(PayoutStrategyAlias.BSC_CRYPTO)).toBe(true);
      expect(aliases.includes(PayoutStrategyAlias.DEFICHAIN_DFI)).toBe(true);
      expect(aliases.includes(PayoutStrategyAlias.DEFICHAIN_TOKEN)).toBe(true);
      expect(aliases.includes(PayoutStrategyAlias.ETHEREUM_CRYPTO)).toBe(true);
      expect(aliases.includes(PayoutStrategyAlias.ETHEREUM_TOKEN)).toBe(true);
    });

    it('assigns proper payoutStrategies to aliases', () => {
      expect(facade.getStrategies().get(PayoutStrategyAlias.BITCOIN)).toBeInstanceOf(BitcoinStrategy);
      expect(facade.getStrategies().get(PayoutStrategyAlias.BSC_CRYPTO)).toBeInstanceOf(BscCryptoStrategy);
      expect(facade.getStrategies().get(PayoutStrategyAlias.BSC_TOKEN)).toBeInstanceOf(BscTokenStrategy);
      expect(facade.getStrategies().get(PayoutStrategyAlias.DEFICHAIN_DFI)).toBeInstanceOf(DeFiChainDfiStrategy);
      expect(facade.getStrategies().get(PayoutStrategyAlias.DEFICHAIN_TOKEN)).toBeInstanceOf(DeFiChainTokenStrategy);
      expect(facade.getStrategies().get(PayoutStrategyAlias.ETHEREUM_CRYPTO)).toBeInstanceOf(EthereumCryptoStrategy);
      expect(facade.getStrategies().get(PayoutStrategyAlias.ETHEREUM_TOKEN)).toBeInstanceOf(EthereumTokenStrategy);
    });
  });

  describe('#getPayoutStrategy(...)', () => {
    describe('getting strategy by Asset', () => {
      it('gets BITCOIN strategy for BITCOIN', () => {
        const strategy = facade.getPayoutStrategy(createCustomAsset({ blockchain: Blockchain.BITCOIN }));

        expect(strategy).toBeInstanceOf(BitcoinStrategy);
      });

      it('gets BSC_CRYPTO strategy', () => {
        const strategy = facade.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN, category: AssetCategory.CRYPTO }),
        );

        expect(strategy).toBeInstanceOf(BscCryptoStrategy);
      });

      it('gets BSC_TOKEN strategy', () => {
        const strategy = facade.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN, category: AssetCategory.STOCK }),
        );

        expect(strategy).toBeInstanceOf(BscTokenStrategy);
      });

      it('gets DEFICHAIN_DFI strategy', () => {
        const strategy = facade.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, dexName: 'DFI' }),
        );

        expect(strategy).toBeInstanceOf(DeFiChainDfiStrategy);
      });

      it('gets DEFICHAIN_TOKEN strategy for DEFICHAIN', () => {
        const strategy = facade.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, dexName: 'non-DFI' }),
        );

        expect(strategy).toBeInstanceOf(DeFiChainTokenStrategy);
      });

      it('gets ETHEREUM_CRYPTO strategy', () => {
        const strategy = facade.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.ETHEREUM, category: AssetCategory.CRYPTO }),
        );

        expect(strategy).toBeInstanceOf(EthereumCryptoStrategy);
      });

      it('gets ETHEREUM_TOKEN strategy', () => {
        const strategy = facade.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.ETHEREUM, category: AssetCategory.STOCK }),
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

      it('gets BSC_CRYPTO strategy', () => {
        const strategyCrypto = facade.getPayoutStrategy(PayoutStrategyAlias.BSC_CRYPTO);

        expect(strategyCrypto).toBeInstanceOf(BscCryptoStrategy);
      });

      it('gets BSC_TOKEN strategy', () => {
        const strategyCrypto = facade.getPayoutStrategy(PayoutStrategyAlias.BSC_TOKEN);

        expect(strategyCrypto).toBeInstanceOf(BscTokenStrategy);
      });

      it('gets DEFICHAIN_DFI strategy', () => {
        const strategy = facade.getPayoutStrategy(PayoutStrategyAlias.DEFICHAIN_DFI);

        expect(strategy).toBeInstanceOf(DeFiChainDfiStrategy);
      });

      it('gets DEFICHAIN_TOKEN strategy', () => {
        const strategy = facade.getPayoutStrategy(PayoutStrategyAlias.DEFICHAIN_TOKEN);

        expect(strategy).toBeInstanceOf(DeFiChainTokenStrategy);
      });

      it('gets ETHEREUM_CRYPTO strategy', () => {
        const strategy = facade.getPayoutStrategy(PayoutStrategyAlias.ETHEREUM_CRYPTO);

        expect(strategy).toBeInstanceOf(EthereumCryptoStrategy);
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
    bscCrypto: BscCryptoStrategy,
    bscToken: BscTokenStrategy,
    deFiChainDfi: DeFiChainDfiStrategy,
    deFiChainToken: DeFiChainTokenStrategy,
    ethereumCrypto: EthereumCryptoStrategy,
    ethereumToken: EthereumTokenStrategy,
  ) {
    super(bitcoin, bscCrypto, bscToken, deFiChainDfi, deFiChainToken, ethereumCrypto, ethereumToken);
  }

  getStrategies() {
    return this.strategies;
  }
}
