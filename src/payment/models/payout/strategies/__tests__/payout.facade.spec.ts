import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { DexService } from 'src/payment/models/dex/services/dex.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { MailService } from 'src/shared/services/mail.service';
import { PayoutOrderRepository } from '../../repositories/payout-order.repository';
import { PayoutBscService } from '../../services/payout-bsc.service';
import { PayoutDeFiChainService } from '../../services/payout-defichain.service';
import { PayoutEthereumService } from '../../services/payout-ethereum.service';
import { BscCryptoStrategy } from '../payout/impl/bsc-crypto.strategy';
import { DeFiChainDfiStrategy } from '../payout/impl/defichain-dfi.strategy';
import { DeFiChainTokenStrategy } from '../payout/impl/defichain-token.strategy';
import { EthereumCryptoStrategy } from '../payout/impl/ethereum-crypto.strategy';
import { PayoutStrategiesFacade, PayoutStrategyAlias } from '../payout/payout.facade';

describe('PayoutStrategiesFacade', () => {
  let dfi: DeFiChainDfiStrategy;
  let token: DeFiChainTokenStrategy;
  let ethCrypto: EthereumCryptoStrategy;
  let bscCrypto: BscCryptoStrategy;

  let facade: PayoutStrategiesFacadeWrapper;

  beforeEach(() => {
    dfi = new DeFiChainDfiStrategy(mock<MailService>(), mock<PayoutDeFiChainService>(), mock<PayoutOrderRepository>());
    token = new DeFiChainTokenStrategy(
      mock<MailService>(),
      mock<DexService>(),
      mock<PayoutDeFiChainService>(),
      mock<PayoutOrderRepository>(),
    );
    ethCrypto = new EthereumCryptoStrategy(mock<PayoutEthereumService>(), mock<PayoutOrderRepository>());
    bscCrypto = new BscCryptoStrategy(mock<PayoutBscService>(), mock<PayoutOrderRepository>());

    facade = new PayoutStrategiesFacadeWrapper(dfi, token, ethCrypto, bscCrypto);
  });

  describe('#constructor(...)', () => {
    it('adds all payoutStrategies to a map', () => {
      expect([...facade.getPayoutStrategies().entries()].length).toBe(4);
    });

    it('sets all required payoutStrategies aliases', () => {
      const aliases = [...facade.getPayoutStrategies().keys()];

      expect(aliases.includes(PayoutStrategyAlias.DEFICHAIN_DFI)).toBe(true);
      expect(aliases.includes(PayoutStrategyAlias.DEFICHAIN_TOKEN)).toBe(true);
      expect(aliases.includes(PayoutStrategyAlias.ETHEREUM_DEFAULT)).toBe(true);
      expect(aliases.includes(PayoutStrategyAlias.BSC_DEFAULT)).toBe(true);
    });

    it('assigns proper payoutStrategies to aliases', () => {
      expect(facade.getPayoutStrategies().get(PayoutStrategyAlias.DEFICHAIN_DFI)).toBeInstanceOf(DeFiChainDfiStrategy);

      expect(facade.getPayoutStrategies().get(PayoutStrategyAlias.DEFICHAIN_TOKEN)).toBeInstanceOf(
        DeFiChainTokenStrategy,
      );

      expect(facade.getPayoutStrategies().get(PayoutStrategyAlias.ETHEREUM_DEFAULT)).toBeInstanceOf(
        EthereumCryptoStrategy,
      );

      expect(facade.getPayoutStrategies().get(PayoutStrategyAlias.BSC_DEFAULT)).toBeInstanceOf(BscCryptoStrategy);
    });
  });

  describe('#getPayoutStrategy(...)', () => {
    describe('getting strategy by Asset', () => {
      it('gets ETHEREUM_DEFAULT strategy', () => {
        const strategy = facade.getPayoutStrategy(createCustomAsset({ blockchain: Blockchain.ETHEREUM }));

        expect(strategy).toBeInstanceOf(EthereumCryptoStrategy);
      });

      it('gets BSC_DEFAULT strategy', () => {
        const strategy = facade.getPayoutStrategy(createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN }));

        expect(strategy).toBeInstanceOf(BscCryptoStrategy);
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

      it('gets DEFICHAIN_TOKEN strategy for BITCOIN', () => {
        const strategy = facade.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.BITCOIN, dexName: 'non-DFI' }),
        );

        expect(strategy).toBeInstanceOf(DeFiChainTokenStrategy);
      });

      it('fails to get strategy for non-supported Blockchain', () => {
        const testCall = () =>
          facade.getPayoutStrategy(createCustomAsset({ blockchain: 'NewBlockchain' as Blockchain }));

        expect(testCall).toThrow();
        expect(testCall).toThrowError('No PayoutStrategy found. Alias: undefined');
      });

      it('fails to get strategy for DFI on Bitcoin blockchain', () => {
        const testCall = () =>
          facade.getPayoutStrategy(createCustomAsset({ blockchain: Blockchain.BITCOIN, dexName: 'DFI' }));

        expect(testCall).toThrow();
        expect(testCall).toThrowError('No PayoutStrategy found. Alias: undefined');
      });
    });

    describe('getting strategy by Alias', () => {
      it('gets ETHEREUM_DEFAULT strategy', () => {
        const strategy = facade.getPayoutStrategy(PayoutStrategyAlias.ETHEREUM_DEFAULT);

        expect(strategy).toBeInstanceOf(EthereumCryptoStrategy);
      });

      it('gets BSC_DEFAULT strategy', () => {
        const strategyCrypto = facade.getPayoutStrategy(PayoutStrategyAlias.BSC_DEFAULT);

        expect(strategyCrypto).toBeInstanceOf(BscCryptoStrategy);
      });

      it('gets DEFICHAIN_DFI strategy', () => {
        const strategy = facade.getPayoutStrategy(PayoutStrategyAlias.DEFICHAIN_DFI);

        expect(strategy).toBeInstanceOf(DeFiChainDfiStrategy);
      });

      it('gets DEFICHAIN_TOKEN strategy', () => {
        const strategy = facade.getPayoutStrategy(PayoutStrategyAlias.DEFICHAIN_TOKEN);

        expect(strategy).toBeInstanceOf(DeFiChainTokenStrategy);
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
    payoutDFIStrategy: DeFiChainDfiStrategy,
    payoutTokenStrategy: DeFiChainTokenStrategy,
    payoutETHStrategy: EthereumCryptoStrategy,
    payoutBSCStrategy: BscCryptoStrategy,
  ) {
    super(payoutDFIStrategy, payoutTokenStrategy, payoutETHStrategy, payoutBSCStrategy);
  }

  getPayoutStrategies() {
    return this.strategies;
  }
}
