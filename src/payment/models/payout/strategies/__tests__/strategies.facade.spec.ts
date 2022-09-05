import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { DexService } from 'src/payment/models/dex/services/dex.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { MailService } from 'src/shared/services/mail.service';
import { PayoutOrderRepository } from '../../repositories/payout-order.repository';
import { PayoutBSCService } from '../../services/payout-bsc.service';
import { PayoutDeFiChainService } from '../../services/payout-defichain.service';
import { PayoutEthereumService } from '../../services/payout-ethereum.service';
import { PayoutBSCStrategy } from '../payout/payout-bsc.strategy';
import { PayoutDeFiChainDFIStrategy } from '../payout/payout-defichain-dfi.strategy';
import { PayoutDeFiChainTokenStrategy } from '../payout/payout-defichain-token.strategy';
import { PayoutEthereumStrategy } from '../payout/payout-ethereum.strategy';
import { PrepareBSCStrategy } from '../prepare/prepare-bsc.strategy';
import { PrepareDeFiChainStrategy } from '../prepare/prepare-defichain.strategy';
import { PrepareEthereumStrategy } from '../prepare/prepare-ethereum.strategy';
import { PayoutStrategiesFacade, PayoutStrategyAlias, PrepareStrategyAlias } from '../strategies.facade';

describe('PayoutStrategiesFacade', () => {
  let payoutDFIStrategy: PayoutDeFiChainDFIStrategy;
  let payoutTokenStrategy: PayoutDeFiChainTokenStrategy;
  let payoutETHStrategy: PayoutEthereumStrategy;
  let payoutBSCStrategy: PayoutBSCStrategy;
  let prepareOnDefichainStrategy: PrepareDeFiChainStrategy;
  let prepareOnEthereumStrategy: PrepareEthereumStrategy;
  let prepareOnBscStrategy: PrepareBSCStrategy;

  let facade: PayoutStrategiesFacadeWrapper;

  beforeEach(() => {
    payoutDFIStrategy = new PayoutDeFiChainDFIStrategy(
      mock<MailService>(),
      mock<PayoutDeFiChainService>(),
      mock<PayoutOrderRepository>(),
    );
    payoutTokenStrategy = new PayoutDeFiChainTokenStrategy(
      mock<MailService>(),
      mock<DexService>(),
      mock<PayoutDeFiChainService>(),
      mock<PayoutOrderRepository>(),
    );
    payoutETHStrategy = new PayoutEthereumStrategy(mock<PayoutEthereumService>(), mock<PayoutOrderRepository>());
    payoutBSCStrategy = new PayoutBSCStrategy(mock<PayoutBSCService>(), mock<PayoutOrderRepository>());
    prepareOnDefichainStrategy = new PrepareDeFiChainStrategy(
      mock<DexService>(),
      mock<PayoutDeFiChainService>(),
      mock<PayoutOrderRepository>(),
    );
    prepareOnEthereumStrategy = new PrepareEthereumStrategy(mock<PayoutOrderRepository>());
    prepareOnBscStrategy = new PrepareBSCStrategy(mock<PayoutOrderRepository>());

    facade = new PayoutStrategiesFacadeWrapper(
      payoutDFIStrategy,
      payoutTokenStrategy,
      payoutETHStrategy,
      payoutBSCStrategy,
      prepareOnDefichainStrategy,
      prepareOnEthereumStrategy,
      prepareOnBscStrategy,
    );
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
      expect(facade.getPayoutStrategies().get(PayoutStrategyAlias.DEFICHAIN_DFI)).toBeInstanceOf(
        PayoutDeFiChainDFIStrategy,
      );

      expect(facade.getPayoutStrategies().get(PayoutStrategyAlias.DEFICHAIN_TOKEN)).toBeInstanceOf(
        PayoutDeFiChainTokenStrategy,
      );

      expect(facade.getPayoutStrategies().get(PayoutStrategyAlias.ETHEREUM_DEFAULT)).toBeInstanceOf(
        PayoutEthereumStrategy,
      );

      expect(facade.getPayoutStrategies().get(PayoutStrategyAlias.BSC_DEFAULT)).toBeInstanceOf(PayoutBSCStrategy);
    });

    it('adds all prepareStrategies to a map', () => {
      expect([...facade.getPrepareStrategies().entries()].length).toBe(3);
    });

    it('sets all required prepareStrategies aliases', () => {
      const aliases = [...facade.getPrepareStrategies().keys()];

      expect(aliases.includes(PrepareStrategyAlias.DEFICHAIN)).toBe(true);
      expect(aliases.includes(PrepareStrategyAlias.ETHEREUM)).toBe(true);
      expect(aliases.includes(PrepareStrategyAlias.BSC)).toBe(true);
    });

    it('assigns proper prepareStrategies to aliases', () => {
      expect(facade.getPrepareStrategies().get(PrepareStrategyAlias.DEFICHAIN)).toBeInstanceOf(
        PrepareDeFiChainStrategy,
      );

      expect(facade.getPrepareStrategies().get(PrepareStrategyAlias.ETHEREUM)).toBeInstanceOf(PrepareEthereumStrategy);

      expect(facade.getPrepareStrategies().get(PrepareStrategyAlias.BSC)).toBeInstanceOf(PrepareBSCStrategy);
    });
  });

  describe('#getPayoutStrategy(...)', () => {
    describe('getting strategy by Asset', () => {
      it('gets ETHEREUM_DEFAULT strategy', () => {
        const strategy = facade.getPayoutStrategy(createCustomAsset({ blockchain: Blockchain.ETHEREUM }));

        expect(strategy).toBeInstanceOf(PayoutEthereumStrategy);
      });

      it('gets BSC_DEFAULT strategy', () => {
        const strategy = facade.getPayoutStrategy(createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN }));

        expect(strategy).toBeInstanceOf(PayoutBSCStrategy);
      });

      it('gets DEFICHAIN_DFI strategy', () => {
        const strategy = facade.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, dexName: 'DFI' }),
        );

        expect(strategy).toBeInstanceOf(PayoutDeFiChainDFIStrategy);
      });

      it('gets DEFICHAIN_TOKEN strategy for DEFICHAIN', () => {
        const strategy = facade.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, dexName: 'non-DFI' }),
        );

        expect(strategy).toBeInstanceOf(PayoutDeFiChainTokenStrategy);
      });

      it('gets DEFICHAIN_TOKEN strategy for BITCOIN', () => {
        const strategy = facade.getPayoutStrategy(
          createCustomAsset({ blockchain: Blockchain.BITCOIN, dexName: 'non-DFI' }),
        );

        expect(strategy).toBeInstanceOf(PayoutDeFiChainTokenStrategy);
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

        expect(strategy).toBeInstanceOf(PayoutEthereumStrategy);
      });

      it('gets BSC_DEFAULT strategy', () => {
        const strategyCrypto = facade.getPayoutStrategy(PayoutStrategyAlias.BSC_DEFAULT);

        expect(strategyCrypto).toBeInstanceOf(PayoutBSCStrategy);
      });

      it('gets DEFICHAIN_DFI strategy', () => {
        const strategy = facade.getPayoutStrategy(PayoutStrategyAlias.DEFICHAIN_DFI);

        expect(strategy).toBeInstanceOf(PayoutDeFiChainDFIStrategy);
      });

      it('gets DEFICHAIN_TOKEN strategy', () => {
        const strategy = facade.getPayoutStrategy(PayoutStrategyAlias.DEFICHAIN_TOKEN);

        expect(strategy).toBeInstanceOf(PayoutDeFiChainTokenStrategy);
      });

      it('fails to get strategy for non-supported Alias', () => {
        const testCall = () => facade.getPayoutStrategy('NonExistingAlias' as PayoutStrategyAlias);

        expect(testCall).toThrow();
        expect(testCall).toThrowError('No PayoutStrategy found. Alias: NonExistingAlias');
      });
    });
  });

  describe('#getPrepareStrategy(...)', () => {
    describe('getting strategy by Asset', () => {
      it('gets ETHEREUM strategy', () => {
        const strategy = facade.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.ETHEREUM }));

        expect(strategy).toBeInstanceOf(PrepareEthereumStrategy);
      });

      it('gets BSC strategy', () => {
        const strategy = facade.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN }));

        expect(strategy).toBeInstanceOf(PrepareBSCStrategy);
      });

      it('gets DEFICHAIN strategy for DEFICHAIN', () => {
        const strategy = facade.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.DEFICHAIN }));

        expect(strategy).toBeInstanceOf(PrepareDeFiChainStrategy);
      });

      it('gets DEFICHAIN strategy for BITCOIN', () => {
        const strategy = facade.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.BITCOIN }));

        expect(strategy).toBeInstanceOf(PrepareDeFiChainStrategy);
      });

      it('fails to get strategy for non-supported Blockchain', () => {
        const testCall = () =>
          facade.getPrepareStrategy(createCustomAsset({ blockchain: 'NewBlockchain' as Blockchain }));

        expect(testCall).toThrow();
        expect(testCall).toThrowError('No PrepareStrategy found. Alias: undefined');
      });
    });

    describe('getting strategy by Alias', () => {
      it('gets DEFICHAIN strategy', () => {
        const strategy = facade.getPrepareStrategy(PrepareStrategyAlias.DEFICHAIN);

        expect(strategy).toBeInstanceOf(PrepareDeFiChainStrategy);
      });

      it('gets ETHEREUM strategy', () => {
        const strategyCrypto = facade.getPrepareStrategy(PrepareStrategyAlias.ETHEREUM);

        expect(strategyCrypto).toBeInstanceOf(PrepareEthereumStrategy);
      });

      it('gets BSC strategy', () => {
        const strategyCrypto = facade.getPrepareStrategy(PrepareStrategyAlias.BSC);

        expect(strategyCrypto).toBeInstanceOf(PrepareBSCStrategy);
      });

      it('fails to get strategy for non-supported Alias', () => {
        const testCall = () => facade.getPrepareStrategy('NonExistingAlias' as PrepareStrategyAlias);

        expect(testCall).toThrow();
        expect(testCall).toThrowError('No PrepareStrategy found. Alias: NonExistingAlias');
      });
    });
  });
});

class PayoutStrategiesFacadeWrapper extends PayoutStrategiesFacade {
  constructor(
    payoutDFIStrategy: PayoutDeFiChainDFIStrategy,
    payoutTokenStrategy: PayoutDeFiChainTokenStrategy,
    payoutETHStrategy: PayoutEthereumStrategy,
    payoutBSCStrategy: PayoutBSCStrategy,
    prepareOnDefichainStrategy: PrepareDeFiChainStrategy,
    prepareOnEthereumStrategy: PrepareEthereumStrategy,
    prepareOnBscStrategy: PrepareBSCStrategy,
  ) {
    super(
      payoutDFIStrategy,
      payoutTokenStrategy,
      payoutETHStrategy,
      payoutBSCStrategy,
      prepareOnDefichainStrategy,
      prepareOnEthereumStrategy,
      prepareOnBscStrategy,
    );
  }

  getPayoutStrategies() {
    return this.payoutStrategies;
  }

  getPrepareStrategies() {
    return this.prepareStrategies;
  }
}
