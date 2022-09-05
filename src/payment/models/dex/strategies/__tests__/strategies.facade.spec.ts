import { mock } from 'jest-mock-extended';
import { BehaviorSubject } from 'rxjs';
import { NodeService } from 'src/blockchain/ain/node/node.service';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { AssetCategory } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { MailService } from 'src/shared/services/mail.service';
import { LiquidityOrderFactory } from '../../factories/liquidity-order.factory';
import { LiquidityOrderRepository } from '../../repositories/liquidity-order.repository';
import { DexBSCService } from '../../services/dex-bsc.service';
import { DexDeFiChainService } from '../../services/dex-defichain.service';
import { DexEthereumService } from '../../services/dex-ethereum.service';
import { DexService } from '../../services/dex.service';
import { CheckLiquidityBSCStrategy } from '../check-liquidity/check-liquidity-bsc.strategy';
import { CheckLiquidityDeFiChainDefaultStrategy } from '../check-liquidity/check-liquidity-defichain-default.strategy';
import { CheckLiquidityDeFiChainPoolPairStrategy } from '../check-liquidity/check-liquidity-defichain-poolpair.strategy';
import { CheckLiquidityEthereumStrategy } from '../check-liquidity/check-liquidity-ethereum.strategy';
import { PurchaseLiquidityBSCStrategy } from '../purchase-liquidity/purchase-liquidity-bsc.strategy';
import { PurchaseLiquidityDeFiChainCryptoStrategy } from '../purchase-liquidity/purchase-liquidity-defichain-crypto.strategy';
import { PurchaseLiquidityDeFiChainPoolPairStrategy } from '../purchase-liquidity/purchase-liquidity-defichain-poolpair.strategy';
import { PurchaseLiquidityDeFiChainStockStrategy } from '../purchase-liquidity/purchase-liquidity-defichain-stock.strategy';
import { PurchaseLiquidityEthereumStrategy } from '../purchase-liquidity/purchase-liquidity-ethereum.strategy';
import { CheckLiquidityStrategyAlias, DexStrategiesFacade, PurchaseLiquidityStrategyAlias } from '../strategies.facade';

describe('DexStrategiesFacade', () => {
  let nodeService: NodeService;

  let checkLiquidityDeFiChainPoolPairStrategy: CheckLiquidityDeFiChainPoolPairStrategy;
  let checkLiquidityDeFiChainDefaultStrategy: CheckLiquidityDeFiChainDefaultStrategy;
  let checkLiquidityEthereumStrategy: CheckLiquidityEthereumStrategy;
  let checkLiquidityBSCStrategy: CheckLiquidityBSCStrategy;
  let purchaseLiquidityDeFiChainPoolPairStrategy: PurchaseLiquidityDeFiChainPoolPairStrategy;
  let purchaseLiquidityDeFiChainStockStrategy: PurchaseLiquidityDeFiChainStockStrategy;
  let purchaseLiquidityDeFiChainCryptoStrategy: PurchaseLiquidityDeFiChainCryptoStrategy;
  let purchaseLiquidityEthereumStrategy: PurchaseLiquidityEthereumStrategy;
  let purchaseLiquidityBSCStrategy: PurchaseLiquidityBSCStrategy;

  let facade: DexStrategiesFacadeWrapper;

  beforeEach(() => {
    nodeService = mock<NodeService>();
    jest.spyOn(nodeService, 'getConnectedNode').mockImplementation(() => new BehaviorSubject(null));

    checkLiquidityDeFiChainPoolPairStrategy = new CheckLiquidityDeFiChainPoolPairStrategy();
    checkLiquidityDeFiChainDefaultStrategy = new CheckLiquidityDeFiChainDefaultStrategy(mock<DexDeFiChainService>());
    checkLiquidityEthereumStrategy = new CheckLiquidityEthereumStrategy(mock<DexEthereumService>());
    checkLiquidityBSCStrategy = new CheckLiquidityBSCStrategy(mock<DexBSCService>());
    purchaseLiquidityDeFiChainPoolPairStrategy = new PurchaseLiquidityDeFiChainPoolPairStrategy(
      nodeService,
      mock<MailService>(),
      mock<SettingService>(),
      mock<AssetService>(),
      mock<LiquidityOrderRepository>(),
      mock<LiquidityOrderFactory>(),
      mock<DexService>(),
    );
    purchaseLiquidityDeFiChainStockStrategy = new PurchaseLiquidityDeFiChainStockStrategy(
      mock<MailService>(),
      mock<DexDeFiChainService>(),
      mock<LiquidityOrderRepository>(),
      mock<LiquidityOrderFactory>(),
    );
    purchaseLiquidityDeFiChainCryptoStrategy = new PurchaseLiquidityDeFiChainCryptoStrategy(
      mock<MailService>(),
      mock<DexDeFiChainService>(),
      mock<LiquidityOrderRepository>(),
      mock<LiquidityOrderFactory>(),
    );
    purchaseLiquidityEthereumStrategy = new PurchaseLiquidityEthereumStrategy(mock<MailService>());
    purchaseLiquidityBSCStrategy = new PurchaseLiquidityBSCStrategy(mock<MailService>());

    facade = new DexStrategiesFacadeWrapper(
      checkLiquidityDeFiChainPoolPairStrategy,
      checkLiquidityDeFiChainDefaultStrategy,
      checkLiquidityEthereumStrategy,
      checkLiquidityBSCStrategy,
      purchaseLiquidityDeFiChainPoolPairStrategy,
      purchaseLiquidityDeFiChainStockStrategy,
      purchaseLiquidityDeFiChainCryptoStrategy,
      purchaseLiquidityEthereumStrategy,
      purchaseLiquidityBSCStrategy,
    );
  });

  describe('#constructor(...)', () => {
    it('adds all checkLiquidityStrategies to a map', () => {
      expect([...facade.getCheckLiquidityStrategies().entries()].length).toBe(4);
    });

    it('sets all required checkLiquidityStrategies aliases', () => {
      const aliases = [...facade.getCheckLiquidityStrategies().keys()];

      expect(aliases.includes(CheckLiquidityStrategyAlias.DEFICHAIN_POOL_PAIR)).toBe(true);
      expect(aliases.includes(CheckLiquidityStrategyAlias.DEFICHAIN_DEFAULT)).toBe(true);
      expect(aliases.includes(CheckLiquidityStrategyAlias.ETHEREUM_DEFAULT)).toBe(true);
      expect(aliases.includes(CheckLiquidityStrategyAlias.BSC_DEFAULT)).toBe(true);
    });

    it('assigns proper checkLiquidityStrategies to aliases', () => {
      expect(facade.getCheckLiquidityStrategies().get(CheckLiquidityStrategyAlias.DEFICHAIN_POOL_PAIR)).toBeInstanceOf(
        CheckLiquidityDeFiChainPoolPairStrategy,
      );

      expect(facade.getCheckLiquidityStrategies().get(CheckLiquidityStrategyAlias.DEFICHAIN_DEFAULT)).toBeInstanceOf(
        CheckLiquidityDeFiChainDefaultStrategy,
      );

      expect(facade.getCheckLiquidityStrategies().get(CheckLiquidityStrategyAlias.ETHEREUM_DEFAULT)).toBeInstanceOf(
        CheckLiquidityEthereumStrategy,
      );

      expect(facade.getCheckLiquidityStrategies().get(CheckLiquidityStrategyAlias.BSC_DEFAULT)).toBeInstanceOf(
        CheckLiquidityBSCStrategy,
      );
    });

    it('adds all purchaseLiquidityStrategies to a map', () => {
      expect([...facade.getPurchaseLiquidityStrategies().entries()].length).toBe(5);
    });

    it('sets all required purchaseLiquidityStrategies aliases', () => {
      const aliases = [...facade.getPurchaseLiquidityStrategies().keys()];

      expect(aliases.includes(PurchaseLiquidityStrategyAlias.DEFICHAIN_POOL_PAIR)).toBe(true);
      expect(aliases.includes(PurchaseLiquidityStrategyAlias.DEFICHAIN_STOCK)).toBe(true);
      expect(aliases.includes(PurchaseLiquidityStrategyAlias.DEFICHAIN_CRYPTO)).toBe(true);
      expect(aliases.includes(PurchaseLiquidityStrategyAlias.ETHEREUM_DEFAULT)).toBe(true);
      expect(aliases.includes(PurchaseLiquidityStrategyAlias.BSC_DEFAULT)).toBe(true);
    });

    it('assigns proper purchaseLiquidityStrategies to aliases', () => {
      expect(
        facade.getPurchaseLiquidityStrategies().get(PurchaseLiquidityStrategyAlias.DEFICHAIN_POOL_PAIR),
      ).toBeInstanceOf(PurchaseLiquidityDeFiChainPoolPairStrategy);

      expect(
        facade.getPurchaseLiquidityStrategies().get(PurchaseLiquidityStrategyAlias.DEFICHAIN_STOCK),
      ).toBeInstanceOf(PurchaseLiquidityDeFiChainStockStrategy);

      expect(
        facade.getPurchaseLiquidityStrategies().get(PurchaseLiquidityStrategyAlias.DEFICHAIN_CRYPTO),
      ).toBeInstanceOf(PurchaseLiquidityDeFiChainCryptoStrategy);

      expect(
        facade.getPurchaseLiquidityStrategies().get(PurchaseLiquidityStrategyAlias.ETHEREUM_DEFAULT),
      ).toBeInstanceOf(PurchaseLiquidityEthereumStrategy);

      expect(facade.getPurchaseLiquidityStrategies().get(PurchaseLiquidityStrategyAlias.BSC_DEFAULT)).toBeInstanceOf(
        PurchaseLiquidityBSCStrategy,
      );
    });
  });

  describe('#getCheckLiquidityStrategy(...)', () => {
    describe('getting strategy by Asset', () => {
      it('gets DEFICHAIN_POOL_PAIR strategy for DEFICHAIN', () => {
        const strategy = facade.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, category: AssetCategory.POOL_PAIR }),
        );

        expect(strategy).toBeInstanceOf(CheckLiquidityDeFiChainPoolPairStrategy);
      });

      it('gets DEFICHAIN_DEFAULT strategy for DEFICHAIN', () => {
        const strategyCrypto = facade.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, category: AssetCategory.CRYPTO }),
        );

        expect(strategyCrypto).toBeInstanceOf(CheckLiquidityDeFiChainDefaultStrategy);

        const strategyStock = facade.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, category: AssetCategory.STOCK }),
        );

        expect(strategyStock).toBeInstanceOf(CheckLiquidityDeFiChainDefaultStrategy);
      });

      it('gets DEFICHAIN_DEFAULT strategy for BITCOIN', () => {
        const strategyCrypto = facade.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.BITCOIN, category: AssetCategory.CRYPTO }),
        );

        expect(strategyCrypto).toBeInstanceOf(CheckLiquidityDeFiChainDefaultStrategy);

        const strategyStock = facade.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.BITCOIN, category: AssetCategory.STOCK }),
        );

        expect(strategyStock).toBeInstanceOf(CheckLiquidityDeFiChainDefaultStrategy);
      });

      it('gets ETHEREUM_DEFAULT strategy', () => {
        const strategy = facade.getCheckLiquidityStrategy(createCustomAsset({ blockchain: Blockchain.ETHEREUM }));

        expect(strategy).toBeInstanceOf(CheckLiquidityEthereumStrategy);
      });

      it('gets BSC_DEFAULT strategy', () => {
        const strategy = facade.getCheckLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN }),
        );

        expect(strategy).toBeInstanceOf(CheckLiquidityBSCStrategy);
      });

      it('fails to get strategy for non-supported Blockchain', () => {
        const testCall = () =>
          facade.getCheckLiquidityStrategy(createCustomAsset({ blockchain: 'NewBlockchain' as Blockchain }));

        expect(testCall).toThrow();
        expect(testCall).toThrowError('No CheckLiquidityStrategy found. Alias: undefined');
      });
    });

    describe('getting strategy by Alias', () => {
      it('gets DEFICHAIN_POOL_PAIR strategy', () => {
        const strategy = facade.getCheckLiquidityStrategy(CheckLiquidityStrategyAlias.DEFICHAIN_POOL_PAIR);

        expect(strategy).toBeInstanceOf(CheckLiquidityDeFiChainPoolPairStrategy);
      });

      it('gets DEFICHAIN_DEFAULT strategy', () => {
        const strategyCrypto = facade.getCheckLiquidityStrategy(CheckLiquidityStrategyAlias.DEFICHAIN_DEFAULT);

        expect(strategyCrypto).toBeInstanceOf(CheckLiquidityDeFiChainDefaultStrategy);
      });

      it('gets ETHEREUM_DEFAULT strategy', () => {
        const strategy = facade.getCheckLiquidityStrategy(CheckLiquidityStrategyAlias.ETHEREUM_DEFAULT);

        expect(strategy).toBeInstanceOf(CheckLiquidityEthereumStrategy);
      });

      it('gets BSC_DEFAULT strategy', () => {
        const strategy = facade.getCheckLiquidityStrategy(CheckLiquidityStrategyAlias.BSC_DEFAULT);

        expect(strategy).toBeInstanceOf(CheckLiquidityBSCStrategy);
      });

      it('fails to get strategy for non-supported Alias', () => {
        const testCall = () => facade.getCheckLiquidityStrategy('NonExistingAlias' as CheckLiquidityStrategyAlias);

        expect(testCall).toThrow();
        expect(testCall).toThrowError('No CheckLiquidityStrategy found. Alias: NonExistingAlias');
      });
    });
  });

  describe('#getPurchaseLiquidityStrategy(...)', () => {
    describe('getting strategy by Asset', () => {
      it('gets DEFICHAIN_POOL_PAIR strategy for DEFICHAIN Pool Pair', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, category: AssetCategory.POOL_PAIR }),
        );

        expect(strategy).toBeInstanceOf(PurchaseLiquidityDeFiChainPoolPairStrategy);
      });

      it('gets DEFICHAIN_STOCK strategy for DEFICHAIN Stock', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, category: AssetCategory.STOCK }),
        );

        expect(strategy).toBeInstanceOf(PurchaseLiquidityDeFiChainStockStrategy);
      });

      it('gets DEFICHAIN_CRYPTO strategy for DEFICHAIN Crypto', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, category: AssetCategory.CRYPTO }),
        );

        expect(strategy).toBeInstanceOf(PurchaseLiquidityDeFiChainCryptoStrategy);
      });

      it('gets DEFICHAIN_CRYPTO strategy for BITCOIN Crypto', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.BITCOIN, category: AssetCategory.CRYPTO }),
        );

        expect(strategy).toBeInstanceOf(PurchaseLiquidityDeFiChainCryptoStrategy);
      });

      it('gets ETHEREUM_DEFAULT strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(createCustomAsset({ blockchain: Blockchain.ETHEREUM }));

        expect(strategy).toBeInstanceOf(PurchaseLiquidityEthereumStrategy);
      });

      it('gets BSC_DEFAULT strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN }),
        );

        expect(strategy).toBeInstanceOf(PurchaseLiquidityBSCStrategy);
      });

      it('fails to get strategy for non-supported Blockchain', () => {
        const testCall = () =>
          facade.getPurchaseLiquidityStrategy(createCustomAsset({ blockchain: 'NewBlockchain' as Blockchain }));

        expect(testCall).toThrow();
        expect(testCall).toThrowError('No PurchaseLiquidityStrategy found. Alias: undefined');
      });

      it('fails to get strategy for non-supported AssetCategory', () => {
        const testCall = () =>
          facade.getPurchaseLiquidityStrategy(
            createCustomAsset({ blockchain: Blockchain.DEFICHAIN, category: 'NewCategory' as AssetCategory }),
          );

        expect(testCall).toThrow();
        expect(testCall).toThrowError('No PurchaseLiquidityStrategy found. Alias: undefined');
      });
    });

    describe('getting strategy by Alias', () => {
      it('gets DEFICHAIN_POOL_PAIR strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(PurchaseLiquidityStrategyAlias.DEFICHAIN_POOL_PAIR);

        expect(strategy).toBeInstanceOf(PurchaseLiquidityDeFiChainPoolPairStrategy);
      });

      it('gets DEFICHAIN_STOCK strategy', () => {
        const strategyCrypto = facade.getPurchaseLiquidityStrategy(PurchaseLiquidityStrategyAlias.DEFICHAIN_STOCK);

        expect(strategyCrypto).toBeInstanceOf(PurchaseLiquidityDeFiChainStockStrategy);
      });

      it('gets DEFICHAIN_CRYPTO strategy', () => {
        const strategyCrypto = facade.getPurchaseLiquidityStrategy(PurchaseLiquidityStrategyAlias.DEFICHAIN_CRYPTO);

        expect(strategyCrypto).toBeInstanceOf(PurchaseLiquidityDeFiChainCryptoStrategy);
      });

      it('gets ETHEREUM_DEFAULT strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(PurchaseLiquidityStrategyAlias.ETHEREUM_DEFAULT);

        expect(strategy).toBeInstanceOf(PurchaseLiquidityEthereumStrategy);
      });

      it('gets BSC_DEFAULT strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(PurchaseLiquidityStrategyAlias.BSC_DEFAULT);

        expect(strategy).toBeInstanceOf(PurchaseLiquidityBSCStrategy);
      });

      it('fails to get strategy for non-supported Alias', () => {
        const testCall = () =>
          facade.getPurchaseLiquidityStrategy('NonExistingAlias' as PurchaseLiquidityStrategyAlias);

        expect(testCall).toThrow();
        expect(testCall).toThrowError('No PurchaseLiquidityStrategy found. Alias: NonExistingAlias');
      });
    });
  });
});

class DexStrategiesFacadeWrapper extends DexStrategiesFacade {
  constructor(
    checkLiquidityDeFiChainPoolPairStrategy: CheckLiquidityDeFiChainPoolPairStrategy,
    checkLiquidityDeFiChainDefaultStrategy: CheckLiquidityDeFiChainDefaultStrategy,
    checkLiquidityEthereumStrategy: CheckLiquidityEthereumStrategy,
    checkLiquidityBSCStrategy: CheckLiquidityBSCStrategy,
    purchaseLiquidityDeFiChainPoolPairStrategy: PurchaseLiquidityDeFiChainPoolPairStrategy,
    purchaseLiquidityDeFiChainStockStrategy: PurchaseLiquidityDeFiChainStockStrategy,
    purchaseLiquidityDeFiChainCryptoStrategy: PurchaseLiquidityDeFiChainCryptoStrategy,
    purchaseLiquidityEthereumStrategy: PurchaseLiquidityEthereumStrategy,
    purchaseLiquidityBSCStrategy: PurchaseLiquidityBSCStrategy,
  ) {
    super(
      checkLiquidityDeFiChainPoolPairStrategy,
      checkLiquidityDeFiChainDefaultStrategy,
      checkLiquidityEthereumStrategy,
      checkLiquidityBSCStrategy,
      purchaseLiquidityDeFiChainPoolPairStrategy,
      purchaseLiquidityDeFiChainStockStrategy,
      purchaseLiquidityDeFiChainCryptoStrategy,
      purchaseLiquidityEthereumStrategy,
      purchaseLiquidityBSCStrategy,
    );
  }

  getCheckLiquidityStrategies() {
    return this.checkLiquidityStrategies;
  }

  getPurchaseLiquidityStrategies() {
    return this.purchaseLiquidityStrategies;
  }
}
