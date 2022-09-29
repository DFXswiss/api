import { mock } from 'jest-mock-extended';
import { BehaviorSubject } from 'rxjs';
import { NodeService } from 'src/blockchain/ain/node/node.service';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { AssetCategory } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { MailService } from 'src/shared/services/mail.service';
import { LiquidityOrderFactory } from '../../../factories/liquidity-order.factory';
import { LiquidityOrderRepository } from '../../../repositories/liquidity-order.repository';
import { DexBscService } from '../../../services/dex-bsc.service';
import { DexDeFiChainService } from '../../../services/dex-defichain.service';
import { DexService } from '../../../services/dex.service';
import { BscCryptoStrategy } from '../impl/bsc-crypto.strategy';
import { DeFiChainCryptoStrategy } from '../impl/defichain-crypto.strategy';
import { DeFiChainPoolPairStrategy } from '../impl/defichain-poolpair.strategy';
import { DeFiChainStockStrategy } from '../impl/defichain-stock.strategy';
import { EthereumCryptoStrategy } from '../impl/ethereum-crypto.strategy';
import { PurchaseLiquidityStrategyAlias, PurchaseLiquidityStrategies } from '../purchase-liquidity.facade';

describe('PurchaseLiquidityStrategies', () => {
  let nodeService: NodeService;

  let deFiChainPoolPair: DeFiChainPoolPairStrategy;
  let deFiChainStock: DeFiChainStockStrategy;
  let deFiChainCrypto: DeFiChainCryptoStrategy;
  let ethereum: EthereumCryptoStrategy;
  let bsc: BscCryptoStrategy;

  let facade: PurchaseLiquidityStrategiesWrapper;

  beforeEach(() => {
    nodeService = mock<NodeService>();
    jest.spyOn(nodeService, 'getConnectedNode').mockImplementation(() => new BehaviorSubject(null));

    deFiChainPoolPair = new DeFiChainPoolPairStrategy(
      nodeService,
      mock<MailService>(),
      mock<SettingService>(),
      mock<AssetService>(),
      mock<LiquidityOrderRepository>(),
      mock<LiquidityOrderFactory>(),
      mock<DexService>(),
    );
    deFiChainStock = new DeFiChainStockStrategy(
      mock<MailService>(),
      mock<DexDeFiChainService>(),
      mock<LiquidityOrderRepository>(),
      mock<LiquidityOrderFactory>(),
    );
    deFiChainCrypto = new DeFiChainCryptoStrategy(
      mock<MailService>(),
      mock<DexDeFiChainService>(),
      mock<LiquidityOrderRepository>(),
      mock<LiquidityOrderFactory>(),
    );
    ethereum = new EthereumCryptoStrategy(mock<MailService>(), mock<DexBscService>());
    bsc = new BscCryptoStrategy(mock<MailService>(), mock<DexBscService>());

    facade = new PurchaseLiquidityStrategiesWrapper(deFiChainPoolPair, deFiChainStock, deFiChainCrypto, ethereum, bsc);
  });

  describe('#constructor(...)', () => {
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
      ).toBeInstanceOf(DeFiChainPoolPairStrategy);

      expect(
        facade.getPurchaseLiquidityStrategies().get(PurchaseLiquidityStrategyAlias.DEFICHAIN_STOCK),
      ).toBeInstanceOf(DeFiChainStockStrategy);

      expect(
        facade.getPurchaseLiquidityStrategies().get(PurchaseLiquidityStrategyAlias.DEFICHAIN_CRYPTO),
      ).toBeInstanceOf(DeFiChainCryptoStrategy);

      expect(
        facade.getPurchaseLiquidityStrategies().get(PurchaseLiquidityStrategyAlias.ETHEREUM_DEFAULT),
      ).toBeInstanceOf(EthereumCryptoStrategy);

      expect(facade.getPurchaseLiquidityStrategies().get(PurchaseLiquidityStrategyAlias.BSC_DEFAULT)).toBeInstanceOf(
        BscCryptoStrategy,
      );
    });
  });

  describe('#getPurchaseLiquidityStrategy(...)', () => {
    describe('getting strategy by Asset', () => {
      it('gets DEFICHAIN_POOL_PAIR strategy for DEFICHAIN Pool Pair', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, category: AssetCategory.POOL_PAIR }),
        );

        expect(strategy).toBeInstanceOf(DeFiChainPoolPairStrategy);
      });

      it('gets DEFICHAIN_STOCK strategy for DEFICHAIN Stock', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, category: AssetCategory.STOCK }),
        );

        expect(strategy).toBeInstanceOf(DeFiChainStockStrategy);
      });

      it('gets DEFICHAIN_CRYPTO strategy for DEFICHAIN Crypto', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, category: AssetCategory.CRYPTO }),
        );

        expect(strategy).toBeInstanceOf(DeFiChainCryptoStrategy);
      });

      it('gets DEFICHAIN_CRYPTO strategy for BITCOIN Crypto', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.BITCOIN, category: AssetCategory.CRYPTO }),
        );

        expect(strategy).toBeInstanceOf(DeFiChainCryptoStrategy);
      });

      it('gets ETHEREUM_DEFAULT strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(createCustomAsset({ blockchain: Blockchain.ETHEREUM }));

        expect(strategy).toBeInstanceOf(EthereumCryptoStrategy);
      });

      it('gets BSC_DEFAULT strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN }),
        );

        expect(strategy).toBeInstanceOf(BscCryptoStrategy);
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

        expect(strategy).toBeInstanceOf(DeFiChainPoolPairStrategy);
      });

      it('gets DEFICHAIN_STOCK strategy', () => {
        const strategyCrypto = facade.getPurchaseLiquidityStrategy(PurchaseLiquidityStrategyAlias.DEFICHAIN_STOCK);

        expect(strategyCrypto).toBeInstanceOf(DeFiChainStockStrategy);
      });

      it('gets DEFICHAIN_CRYPTO strategy', () => {
        const strategyCrypto = facade.getPurchaseLiquidityStrategy(PurchaseLiquidityStrategyAlias.DEFICHAIN_CRYPTO);

        expect(strategyCrypto).toBeInstanceOf(DeFiChainCryptoStrategy);
      });

      it('gets ETHEREUM_DEFAULT strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(PurchaseLiquidityStrategyAlias.ETHEREUM_DEFAULT);

        expect(strategy).toBeInstanceOf(EthereumCryptoStrategy);
      });

      it('gets BSC_DEFAULT strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(PurchaseLiquidityStrategyAlias.BSC_DEFAULT);

        expect(strategy).toBeInstanceOf(BscCryptoStrategy);
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

class PurchaseLiquidityStrategiesWrapper extends PurchaseLiquidityStrategies {
  constructor(
    purchaseLiquidityDeFiChainPoolPairStrategy: DeFiChainPoolPairStrategy,
    purchaseLiquidityDeFiChainStockStrategy: DeFiChainStockStrategy,
    purchaseLiquidityDeFiChainCryptoStrategy: DeFiChainCryptoStrategy,
    purchaseLiquidityEthereumStrategy: EthereumCryptoStrategy,
    purchaseLiquidityBSCStrategy: BscCryptoStrategy,
  ) {
    super(
      purchaseLiquidityDeFiChainPoolPairStrategy,
      purchaseLiquidityDeFiChainStockStrategy,
      purchaseLiquidityDeFiChainCryptoStrategy,
      purchaseLiquidityEthereumStrategy,
      purchaseLiquidityBSCStrategy,
    );
  }

  getPurchaseLiquidityStrategies() {
    return this.purchaseLiquidityStrategies;
  }
}
