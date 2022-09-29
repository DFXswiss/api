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
import { BitcoinStrategy } from '../impl/bitcoin.strategy';
import { BscCryptoStrategy } from '../impl/bsc-crypto.strategy';
import { BscTokenStrategy } from '../impl/bsc-token.strategy';
import { DeFiChainCryptoStrategy } from '../impl/defichain-crypto.strategy';
import { DeFiChainPoolPairStrategy } from '../impl/defichain-poolpair.strategy';
import { DeFiChainStockStrategy } from '../impl/defichain-stock.strategy';
import { EthereumCryptoStrategy } from '../impl/ethereum-crypto.strategy';
import { EthereumTokenStrategy } from '../impl/ethereum-token.strategy';
import { PurchaseLiquidityStrategyAlias, PurchaseLiquidityStrategies } from '../purchase-liquidity.facade';

describe('PurchaseLiquidityStrategies', () => {
  let nodeService: NodeService;

  let bitcoin: BitcoinStrategy;
  let bscCrypto: BscCryptoStrategy;
  let bscToken: BscTokenStrategy;
  let deFiChainPoolPair: DeFiChainPoolPairStrategy;
  let deFiChainStock: DeFiChainStockStrategy;
  let deFiChainCrypto: DeFiChainCryptoStrategy;
  let ethereumCrypto: EthereumCryptoStrategy;
  let ethereumToken: EthereumTokenStrategy;

  let facade: PurchaseLiquidityStrategiesWrapper;

  beforeEach(() => {
    nodeService = mock<NodeService>();
    jest.spyOn(nodeService, 'getConnectedNode').mockImplementation(() => new BehaviorSubject(null));

    bitcoin = new BitcoinStrategy(mock<MailService>());
    bscCrypto = new BscCryptoStrategy(mock<MailService>(), mock<DexBscService>());
    bscToken = new BscTokenStrategy(mock<MailService>(), mock<DexBscService>());

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
    ethereumCrypto = new EthereumCryptoStrategy(mock<MailService>(), mock<DexBscService>());
    ethereumToken = new EthereumTokenStrategy(mock<MailService>(), mock<DexBscService>());

    facade = new PurchaseLiquidityStrategiesWrapper(
      bitcoin,
      bscCrypto,
      bscToken,
      deFiChainCrypto,
      deFiChainPoolPair,
      deFiChainStock,
      ethereumCrypto,
      ethereumToken,
    );
  });

  describe('#constructor(...)', () => {
    it('adds all purchaseLiquidityStrategies to a map', () => {
      expect([...facade.getStrategies().entries()].length).toBe(8);
    });

    it('assigns strategies to all aliases', () => {
      expect([...facade.getStrategies().entries()].length).toBe(Object.values(PurchaseLiquidityStrategyAlias).length);
    });

    it('sets all required purchaseLiquidityStrategies aliases', () => {
      const aliases = [...facade.getStrategies().keys()];

      expect(aliases.includes(PurchaseLiquidityStrategyAlias.BITCOIN)).toBe(true);
      expect(aliases.includes(PurchaseLiquidityStrategyAlias.BSC_CRYPTO)).toBe(true);
      expect(aliases.includes(PurchaseLiquidityStrategyAlias.BSC_TOKEN)).toBe(true);
      expect(aliases.includes(PurchaseLiquidityStrategyAlias.DEFICHAIN_POOL_PAIR)).toBe(true);
      expect(aliases.includes(PurchaseLiquidityStrategyAlias.DEFICHAIN_STOCK)).toBe(true);
      expect(aliases.includes(PurchaseLiquidityStrategyAlias.DEFICHAIN_CRYPTO)).toBe(true);
      expect(aliases.includes(PurchaseLiquidityStrategyAlias.ETHEREUM_CRYPTO)).toBe(true);
      expect(aliases.includes(PurchaseLiquidityStrategyAlias.ETHEREUM_TOKEN)).toBe(true);
    });

    it('assigns proper purchaseLiquidityStrategies to aliases', () => {
      expect(facade.getStrategies().get(PurchaseLiquidityStrategyAlias.BITCOIN)).toBeInstanceOf(BitcoinStrategy);
      expect(facade.getStrategies().get(PurchaseLiquidityStrategyAlias.BSC_CRYPTO)).toBeInstanceOf(BscCryptoStrategy);
      expect(facade.getStrategies().get(PurchaseLiquidityStrategyAlias.BSC_TOKEN)).toBeInstanceOf(BscTokenStrategy);
      expect(facade.getStrategies().get(PurchaseLiquidityStrategyAlias.DEFICHAIN_CRYPTO)).toBeInstanceOf(
        DeFiChainCryptoStrategy,
      );
      expect(facade.getStrategies().get(PurchaseLiquidityStrategyAlias.DEFICHAIN_POOL_PAIR)).toBeInstanceOf(
        DeFiChainPoolPairStrategy,
      );
      expect(facade.getStrategies().get(PurchaseLiquidityStrategyAlias.DEFICHAIN_STOCK)).toBeInstanceOf(
        DeFiChainStockStrategy,
      );
      expect(facade.getStrategies().get(PurchaseLiquidityStrategyAlias.ETHEREUM_CRYPTO)).toBeInstanceOf(
        EthereumCryptoStrategy,
      );
      expect(facade.getStrategies().get(PurchaseLiquidityStrategyAlias.ETHEREUM_TOKEN)).toBeInstanceOf(
        EthereumTokenStrategy,
      );
    });
  });

  describe('#getPurchaseLiquidityStrategy(...)', () => {
    describe('getting strategy by Asset', () => {
      it('gets BITCOIN strategy for BITCOIN Crypto', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(createCustomAsset({ blockchain: Blockchain.BITCOIN }));

        expect(strategy).toBeInstanceOf(BitcoinStrategy);
      });

      it('gets BSC_CRYPTO strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN, category: AssetCategory.CRYPTO }),
        );

        expect(strategy).toBeInstanceOf(BscCryptoStrategy);
      });

      it('gets BSC_TOKEN strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN, category: AssetCategory.STOCK }),
        );

        expect(strategy).toBeInstanceOf(BscTokenStrategy);
      });

      it('gets DEFICHAIN_CRYPTO strategy for DEFICHAIN Crypto', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.DEFICHAIN, category: AssetCategory.CRYPTO }),
        );

        expect(strategy).toBeInstanceOf(DeFiChainCryptoStrategy);
      });

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

      it('gets ETHEREUM_CRYPTO strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.ETHEREUM, category: AssetCategory.CRYPTO }),
        );

        expect(strategy).toBeInstanceOf(EthereumCryptoStrategy);
      });

      it('gets ETHEREUM_TOKEN strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.ETHEREUM, category: AssetCategory.STOCK }),
        );

        expect(strategy).toBeInstanceOf(EthereumTokenStrategy);
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
      it('gets BSC_CRYPTO strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(PurchaseLiquidityStrategyAlias.BITCOIN);

        expect(strategy).toBeInstanceOf(BitcoinStrategy);
      });

      it('gets BSC_CRYPTO strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(PurchaseLiquidityStrategyAlias.BSC_CRYPTO);

        expect(strategy).toBeInstanceOf(BscCryptoStrategy);
      });

      it('gets BSC_TOKEN strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(PurchaseLiquidityStrategyAlias.BSC_TOKEN);

        expect(strategy).toBeInstanceOf(BscTokenStrategy);
      });

      it('gets DEFICHAIN_CRYPTO strategy', () => {
        const strategyCrypto = facade.getPurchaseLiquidityStrategy(PurchaseLiquidityStrategyAlias.DEFICHAIN_CRYPTO);

        expect(strategyCrypto).toBeInstanceOf(DeFiChainCryptoStrategy);
      });

      it('gets DEFICHAIN_POOL_PAIR strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(PurchaseLiquidityStrategyAlias.DEFICHAIN_POOL_PAIR);

        expect(strategy).toBeInstanceOf(DeFiChainPoolPairStrategy);
      });

      it('gets DEFICHAIN_STOCK strategy', () => {
        const strategyCrypto = facade.getPurchaseLiquidityStrategy(PurchaseLiquidityStrategyAlias.DEFICHAIN_STOCK);

        expect(strategyCrypto).toBeInstanceOf(DeFiChainStockStrategy);
      });

      it('gets ETHEREUM_CRYPTO strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(PurchaseLiquidityStrategyAlias.ETHEREUM_CRYPTO);

        expect(strategy).toBeInstanceOf(EthereumCryptoStrategy);
      });

      it('gets ETHEREUM_TOKEN strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(PurchaseLiquidityStrategyAlias.ETHEREUM_TOKEN);

        expect(strategy).toBeInstanceOf(EthereumTokenStrategy);
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
    bitcoin: BitcoinStrategy,
    bscCrypto: BscCryptoStrategy,
    bscToken: BscTokenStrategy,
    deFiChainCrypto: DeFiChainCryptoStrategy,
    deFiChainPoolPair: DeFiChainPoolPairStrategy,
    deFiChainStock: DeFiChainStockStrategy,
    ethereumCrypto: EthereumCryptoStrategy,
    ethereumToken: EthereumTokenStrategy,
  ) {
    super(
      bitcoin,
      bscCrypto,
      bscToken,
      deFiChainCrypto,
      deFiChainPoolPair,
      deFiChainStock,
      ethereumCrypto,
      ethereumToken,
    );
  }

  getStrategies() {
    return this.strategies;
  }
}
