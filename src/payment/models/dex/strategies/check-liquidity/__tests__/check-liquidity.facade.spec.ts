import { mock } from 'jest-mock-extended';
import { BehaviorSubject } from 'rxjs';
import { NodeService } from 'src/blockchain/ain/node/node.service';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { AssetCategory } from 'src/shared/models/asset/asset.entity';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { DexBscService } from '../../../services/dex-bsc.service';
import { DexDeFiChainService } from '../../../services/dex-defichain.service';
import { DexEthereumService } from '../../../services/dex-ethereum.service';
import { CheckLiquidityStrategies } from '../check-liquidity.facade';
import { BscCryptoStrategy } from '../impl/bsc-crypto.strategy';
import { DeFiChainDefaultStrategy } from '../impl/defichain-default.strategy';
import { DeFiChainPoolPairStrategy } from '../impl/defichain-poolpair.strategy';
import { EthereumCryptoStrategy } from '../impl/ethereum-crypto.strategy';
import { CheckLiquidityAlias } from '../check-liquidity.facade';

describe('CheckLiquidityStrategies', () => {
  let nodeService: NodeService;

  let deFiChainPoolPair: DeFiChainPoolPairStrategy;
  let deFiChainDefault: DeFiChainDefaultStrategy;
  let ethereum: EthereumCryptoStrategy;
  let bsc: BscCryptoStrategy;

  let facade: CheckLiquidityStrategiesWrapper;

  beforeEach(() => {
    nodeService = mock<NodeService>();
    jest.spyOn(nodeService, 'getConnectedNode').mockImplementation(() => new BehaviorSubject(null));

    deFiChainPoolPair = new DeFiChainPoolPairStrategy();
    deFiChainDefault = new DeFiChainDefaultStrategy(mock<DexDeFiChainService>());
    ethereum = new EthereumCryptoStrategy(mock<DexEthereumService>());
    bsc = new BscCryptoStrategy(mock<DexBscService>());

    facade = new CheckLiquidityStrategiesWrapper(deFiChainPoolPair, deFiChainDefault, ethereum, bsc);
  });

  describe('#constructor(...)', () => {
    it('adds all checkLiquidityStrategies to a map', () => {
      expect([...facade.getCheckLiquidityStrategies().entries()].length).toBe(4);
    });

    it('sets all required checkLiquidityStrategies aliases', () => {
      const aliases = [...facade.getCheckLiquidityStrategies().keys()];

      expect(aliases.includes(CheckLiquidityAlias.DEFICHAIN_POOL_PAIR)).toBe(true);
      expect(aliases.includes(CheckLiquidityAlias.DEFICHAIN_DEFAULT)).toBe(true);
      expect(aliases.includes(CheckLiquidityAlias.ETHEREUM_DEFAULT)).toBe(true);
      expect(aliases.includes(CheckLiquidityAlias.BSC_DEFAULT)).toBe(true);
    });

    it('assigns proper checkLiquidityStrategies to aliases', () => {
      expect(facade.getCheckLiquidityStrategies().get(CheckLiquidityAlias.DEFICHAIN_POOL_PAIR)).toBeInstanceOf(
        DeFiChainPoolPairStrategy,
      );

      expect(facade.getCheckLiquidityStrategies().get(CheckLiquidityAlias.DEFICHAIN_DEFAULT)).toBeInstanceOf(
        DeFiChainDefaultStrategy,
      );

      expect(facade.getCheckLiquidityStrategies().get(CheckLiquidityAlias.ETHEREUM_DEFAULT)).toBeInstanceOf(
        EthereumCryptoStrategy,
      );

      expect(facade.getCheckLiquidityStrategies().get(CheckLiquidityAlias.BSC_DEFAULT)).toBeInstanceOf(
        BscCryptoStrategy,
      );
    });
  });

  describe('#getCheckLiquidityStrategy(...)', () => {
    describe('getting strategy by Asset', () => {
      it('gets DEFICHAIN_POOL_PAIR strategy for DEFICHAIN', () => {
        const strategy = facade.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, category: AssetCategory.POOL_PAIR }),
        );

        expect(strategy).toBeInstanceOf(DeFiChainPoolPairStrategy);
      });

      it('gets DEFICHAIN_DEFAULT strategy for DEFICHAIN', () => {
        const strategyCrypto = facade.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, category: AssetCategory.CRYPTO }),
        );

        expect(strategyCrypto).toBeInstanceOf(DeFiChainDefaultStrategy);

        const strategyStock = facade.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, category: AssetCategory.STOCK }),
        );

        expect(strategyStock).toBeInstanceOf(DeFiChainDefaultStrategy);
      });

      it('gets DEFICHAIN_DEFAULT strategy for BITCOIN', () => {
        const strategyCrypto = facade.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.BITCOIN, category: AssetCategory.CRYPTO }),
        );

        expect(strategyCrypto).toBeInstanceOf(DeFiChainDefaultStrategy);

        const strategyStock = facade.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.BITCOIN, category: AssetCategory.STOCK }),
        );

        expect(strategyStock).toBeInstanceOf(DeFiChainDefaultStrategy);
      });

      it('gets ETHEREUM_DEFAULT strategy', () => {
        const strategy = facade.getCheckLiquidityStrategy(createCustomAsset({ blockchain: Blockchain.ETHEREUM }));

        expect(strategy).toBeInstanceOf(EthereumCryptoStrategy);
      });

      it('gets BSC_DEFAULT strategy', () => {
        const strategy = facade.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN }),
        );

        expect(strategy).toBeInstanceOf(BscCryptoStrategy);
      });

      it('fails to get strategy for non-supported Blockchain', () => {
        const testCall = () =>
          facade.getCheckLiquidityStrategy(createCustomAsset({ blockchain: 'NewBlockchain' as Blockchain }));

        expect(testCall).toThrow();
        expect(testCall).toThrowError('No CheckLiquidityStrategy found. Alias: undefined');
      });
    });

    describe('getting strategy by CheckLiquidityAlias', () => {
      it('gets DEFICHAIN_POOL_PAIR strategy', () => {
        const strategy = facade.getCheckLiquidityStrategy(CheckLiquidityAlias.DEFICHAIN_POOL_PAIR);

        expect(strategy).toBeInstanceOf(DeFiChainPoolPairStrategy);
      });

      it('gets DEFICHAIN_DEFAULT strategy', () => {
        const strategyCrypto = facade.getCheckLiquidityStrategy(CheckLiquidityAlias.DEFICHAIN_DEFAULT);

        expect(strategyCrypto).toBeInstanceOf(DeFiChainDefaultStrategy);
      });

      it('gets ETHEREUM_DEFAULT strategy', () => {
        const strategy = facade.getCheckLiquidityStrategy(CheckLiquidityAlias.ETHEREUM_DEFAULT);

        expect(strategy).toBeInstanceOf(EthereumCryptoStrategy);
      });

      it('gets BSC_DEFAULT strategy', () => {
        const strategy = facade.getCheckLiquidityStrategy(CheckLiquidityAlias.BSC_DEFAULT);

        expect(strategy).toBeInstanceOf(BscCryptoStrategy);
      });

      it('fails to get strategy for non-supported CheckLiquidityAlias', () => {
        const testCall = () =>
          facade.getCheckLiquidityStrategy('NonExistingCheckLiquidityAlias' as CheckLiquidityAlias);

        expect(testCall).toThrow();
        expect(testCall).toThrowError('No CheckLiquidityStrategy found. Alias: NonExistingCheckLiquidityAlias');
      });
    });
  });
});

class CheckLiquidityStrategiesWrapper extends CheckLiquidityStrategies {
  constructor(
    checkLiquidityDeFiChainPoolPairStrategy: DeFiChainPoolPairStrategy,
    checkLiquidityDeFiChainDefaultStrategy: DeFiChainDefaultStrategy,
    checkLiquidityEthereumStrategy: EthereumCryptoStrategy,
    checkLiquidityBSCStrategy: BscCryptoStrategy,
  ) {
    super(
      checkLiquidityDeFiChainPoolPairStrategy,
      checkLiquidityDeFiChainDefaultStrategy,
      checkLiquidityEthereumStrategy,
      checkLiquidityBSCStrategy,
    );
  }

  getCheckLiquidityStrategies() {
    return this.strategies;
  }
}
