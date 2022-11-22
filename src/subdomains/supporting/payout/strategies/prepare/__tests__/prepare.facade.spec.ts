import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutDeFiChainService } from '../../../services/payout-defichain.service';
import { BitcoinStrategy } from '../impl/bitcoin.strategy';
import { BscStrategy } from '../impl/bsc.strategy';
import { DeFiChainStrategy } from '../impl/defichain.strategy';
import { EthereumStrategy } from '../impl/ethereum.strategy';
import { PrepareStrategiesFacade, PrepareStrategyAlias } from '../prepare.facade';

describe('PrepareStrategiesFacade', () => {
  let bitcoin: BitcoinStrategy;
  let defichain: DeFiChainStrategy;
  let ethereum: EthereumStrategy;
  let bsc: BscStrategy;

  let facade: PrepareStrategiesFacadeWrapper;

  beforeEach(() => {
    bitcoin = new BitcoinStrategy(mock<AssetService>(), mock<PayoutOrderRepository>());
    defichain = new DeFiChainStrategy(
      mock<AssetService>(),
      mock<DexService>(),
      mock<PayoutDeFiChainService>(),
      mock<PayoutOrderRepository>(),
    );
    ethereum = new EthereumStrategy(mock<AssetService>(), mock<PayoutOrderRepository>());
    bsc = new BscStrategy(mock<AssetService>(), mock<PayoutOrderRepository>());

    facade = new PrepareStrategiesFacadeWrapper(bitcoin, defichain, ethereum, bsc);
  });

  describe('#constructor(...)', () => {
    it('adds all prepareStrategies to a map', () => {
      expect([...facade.getStrategies().entries()].length).toBe(4);
    });

    it('assigns strategies to all aliases', () => {
      expect([...facade.getStrategies().entries()].length).toBe(Object.values(PrepareStrategyAlias).length);
    });

    it('sets all required prepareStrategies aliases', () => {
      const aliases = [...facade.getStrategies().keys()];

      expect(aliases.includes(PrepareStrategyAlias.BITCOIN)).toBe(true);
      expect(aliases.includes(PrepareStrategyAlias.DEFICHAIN)).toBe(true);
      expect(aliases.includes(PrepareStrategyAlias.ETHEREUM)).toBe(true);
      expect(aliases.includes(PrepareStrategyAlias.BSC)).toBe(true);
    });

    it('assigns proper prepareStrategies to aliases', () => {
      expect(facade.getStrategies().get(PrepareStrategyAlias.BITCOIN)).toBeInstanceOf(BitcoinStrategy);

      expect(facade.getStrategies().get(PrepareStrategyAlias.DEFICHAIN)).toBeInstanceOf(DeFiChainStrategy);

      expect(facade.getStrategies().get(PrepareStrategyAlias.ETHEREUM)).toBeInstanceOf(EthereumStrategy);

      expect(facade.getStrategies().get(PrepareStrategyAlias.BSC)).toBeInstanceOf(BscStrategy);
    });
  });

  describe('#getPrepareStrategy(...)', () => {
    describe('getting strategy by Asset', () => {
      it('gets BITCOIN strategy for BITCOIN', () => {
        const strategy = facade.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.BITCOIN }));

        expect(strategy).toBeInstanceOf(BitcoinStrategy);
      });

      it('gets ETHEREUM strategy', () => {
        const strategy = facade.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.ETHEREUM }));

        expect(strategy).toBeInstanceOf(EthereumStrategy);
      });

      it('gets BSC strategy', () => {
        const strategy = facade.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN }));

        expect(strategy).toBeInstanceOf(BscStrategy);
      });

      it('gets DEFICHAIN strategy for DEFICHAIN', () => {
        const strategy = facade.getPrepareStrategy(createCustomAsset({ blockchain: Blockchain.DEFICHAIN }));

        expect(strategy).toBeInstanceOf(DeFiChainStrategy);
      });

      it('fails to get strategy for non-supported Blockchain', () => {
        const testCall = () =>
          facade.getPrepareStrategy(createCustomAsset({ blockchain: 'NewBlockchain' as Blockchain }));

        expect(testCall).toThrow();
        expect(testCall).toThrowError('No PrepareStrategy found. Alias: undefined');
      });
    });

    describe('getting strategy by Alias', () => {
      it('gets BITCOIN strategy', () => {
        const strategy = facade.getPrepareStrategy(PrepareStrategyAlias.BITCOIN);

        expect(strategy).toBeInstanceOf(BitcoinStrategy);
      });

      it('gets DEFICHAIN strategy', () => {
        const strategy = facade.getPrepareStrategy(PrepareStrategyAlias.DEFICHAIN);

        expect(strategy).toBeInstanceOf(DeFiChainStrategy);
      });

      it('gets ETHEREUM strategy', () => {
        const strategyCrypto = facade.getPrepareStrategy(PrepareStrategyAlias.ETHEREUM);

        expect(strategyCrypto).toBeInstanceOf(EthereumStrategy);
      });

      it('gets BSC strategy', () => {
        const strategyCrypto = facade.getPrepareStrategy(PrepareStrategyAlias.BSC);

        expect(strategyCrypto).toBeInstanceOf(BscStrategy);
      });

      it('fails to get strategy for non-supported Alias', () => {
        const testCall = () => facade.getPrepareStrategy('NonExistingAlias' as PrepareStrategyAlias);

        expect(testCall).toThrow();
        expect(testCall).toThrowError('No PrepareStrategy found. Alias: NonExistingAlias');
      });
    });
  });
});

class PrepareStrategiesFacadeWrapper extends PrepareStrategiesFacade {
  constructor(bitcoin: BitcoinStrategy, defichain: DeFiChainStrategy, ethereum: EthereumStrategy, bsc: BscStrategy) {
    super(bitcoin, defichain, ethereum, bsc);
  }

  getStrategies() {
    return this.strategies;
  }
}
