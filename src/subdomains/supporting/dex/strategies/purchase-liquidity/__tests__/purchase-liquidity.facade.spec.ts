import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { LiquidityOrderFactory } from '../../../factories/liquidity-order.factory';
import { LiquidityOrderRepository } from '../../../repositories/liquidity-order.repository';
import { DexBitcoinService } from '../../../services/dex-bitcoin.service';
import { DexBscService } from '../../../services/dex-bsc.service';
import { DexDeFiChainService } from '../../../services/dex-defichain.service';
import { DexService } from '../../../services/dex.service';
import { BitcoinStrategy } from '../impl/bitcoin.strategy';
import { BscCoinStrategy } from '../impl/bsc-coin.strategy';
import { BscTokenStrategy } from '../impl/bsc-token.strategy';
import { DeFiChainCryptoStrategy } from '../impl/defichain-crypto.strategy';
import { DeFiChainPoolPairStrategy } from '../impl/defichain-poolpair.strategy';
import { DeFiChainStockStrategy } from '../impl/defichain-stock.strategy';
import { EthereumCoinStrategy } from '../impl/ethereum-coin.strategy';
import { EthereumTokenStrategy } from '../impl/ethereum-token.strategy';
import { PurchaseLiquidityStrategyAlias, PurchaseLiquidityStrategies } from '../purchase-liquidity.facade';

describe('PurchaseLiquidityStrategies', () => {
  let bitcoin: BitcoinStrategy;
  let bscCoin: BscCoinStrategy;
  let bscToken: BscTokenStrategy;
  let deFiChainPoolPair: DeFiChainPoolPairStrategy;
  let deFiChainStock: DeFiChainStockStrategy;
  let deFiChainCrypto: DeFiChainCryptoStrategy;
  let ethereumCoin: EthereumCoinStrategy;
  let ethereumToken: EthereumTokenStrategy;

  let facade: PurchaseLiquidityStrategiesWrapper;

  beforeEach(() => {
    bitcoin = new BitcoinStrategy(mock<AssetService>(), mock<NotificationService>(), mock<DexBitcoinService>());
    bscCoin = new BscCoinStrategy(mock<AssetService>(), mock<NotificationService>(), mock<DexBscService>());
    bscToken = new BscTokenStrategy(mock<AssetService>(), mock<NotificationService>(), mock<DexBscService>());

    deFiChainPoolPair = new DeFiChainPoolPairStrategy(
      mock<NotificationService>(),
      mock<SettingService>(),
      mock<AssetService>(),
      mock<LiquidityOrderRepository>(),
      mock<LiquidityOrderFactory>(),
      mock<DexService>(),
      mock<DexDeFiChainService>(),
    );
    deFiChainStock = new DeFiChainStockStrategy(
      mock<NotificationService>(),
      mock<AssetService>(),
      mock<DexDeFiChainService>(),
      mock<LiquidityOrderRepository>(),
      mock<LiquidityOrderFactory>(),
    );
    deFiChainCrypto = new DeFiChainCryptoStrategy(
      mock<NotificationService>(),
      mock<AssetService>(),
      mock<DexDeFiChainService>(),
      mock<LiquidityOrderRepository>(),
      mock<LiquidityOrderFactory>(),
    );
    ethereumCoin = new EthereumCoinStrategy(mock<AssetService>(), mock<NotificationService>(), mock<DexBscService>());
    ethereumToken = new EthereumTokenStrategy(mock<AssetService>(), mock<NotificationService>(), mock<DexBscService>());

    facade = new PurchaseLiquidityStrategiesWrapper(
      bitcoin,
      bscCoin,
      bscToken,
      deFiChainCrypto,
      deFiChainPoolPair,
      deFiChainStock,
      ethereumCoin,
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
      expect(aliases.includes(PurchaseLiquidityStrategyAlias.BSC_COIN)).toBe(true);
      expect(aliases.includes(PurchaseLiquidityStrategyAlias.BSC_TOKEN)).toBe(true);
      expect(aliases.includes(PurchaseLiquidityStrategyAlias.DEFICHAIN_POOL_PAIR)).toBe(true);
      expect(aliases.includes(PurchaseLiquidityStrategyAlias.DEFICHAIN_STOCK)).toBe(true);
      expect(aliases.includes(PurchaseLiquidityStrategyAlias.DEFICHAIN_CRYPTO)).toBe(true);
      expect(aliases.includes(PurchaseLiquidityStrategyAlias.ETHEREUM_COIN)).toBe(true);
      expect(aliases.includes(PurchaseLiquidityStrategyAlias.ETHEREUM_TOKEN)).toBe(true);
    });

    it('assigns proper purchaseLiquidityStrategies to aliases', () => {
      expect(facade.getStrategies().get(PurchaseLiquidityStrategyAlias.BITCOIN)).toBeInstanceOf(BitcoinStrategy);
      expect(facade.getStrategies().get(PurchaseLiquidityStrategyAlias.BSC_COIN)).toBeInstanceOf(BscCoinStrategy);
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
      expect(facade.getStrategies().get(PurchaseLiquidityStrategyAlias.ETHEREUM_COIN)).toBeInstanceOf(
        EthereumCoinStrategy,
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

      it('gets BSC_COIN strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(BscCoinStrategy);
      });

      it('gets BSC_TOKEN strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.BINANCE_SMART_CHAIN, type: AssetType.TOKEN }),
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

      it('gets ETHEREUM_COIN strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.ETHEREUM, type: AssetType.COIN }),
        );

        expect(strategy).toBeInstanceOf(EthereumCoinStrategy);
      });

      it('gets ETHEREUM_TOKEN strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(
          createCustomAsset({ blockchain: Blockchain.ETHEREUM, type: AssetType.TOKEN }),
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
      it('gets BITCOIN strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(PurchaseLiquidityStrategyAlias.BITCOIN);

        expect(strategy).toBeInstanceOf(BitcoinStrategy);
      });

      it('gets BSC_COIN strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(PurchaseLiquidityStrategyAlias.BSC_COIN);

        expect(strategy).toBeInstanceOf(BscCoinStrategy);
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

      it('gets ETHEREUM_COIN strategy', () => {
        const strategy = facade.getPurchaseLiquidityStrategy(PurchaseLiquidityStrategyAlias.ETHEREUM_COIN);

        expect(strategy).toBeInstanceOf(EthereumCoinStrategy);
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
    bscCoin: BscCoinStrategy,
    bscToken: BscTokenStrategy,
    deFiChainCrypto: DeFiChainCryptoStrategy,
    deFiChainPoolPair: DeFiChainPoolPairStrategy,
    deFiChainStock: DeFiChainStockStrategy,
    ethereumCoin: EthereumCoinStrategy,
    ethereumToken: EthereumTokenStrategy,
  ) {
    super(bitcoin, bscCoin, bscToken, deFiChainCrypto, deFiChainPoolPair, deFiChainStock, ethereumCoin, ethereumToken);
  }

  getStrategies() {
    return this.strategies;
  }
}
