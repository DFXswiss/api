import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetCategory } from 'src/shared/models/asset/asset.entity';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { LiquidityOrder, LiquidityOrderContext, LiquidityOrderType } from '../../entities/liquidity-order.entity';
import { createDefaultLiquidityOrder } from '../../entities/__mocks__/liquidity-order.entity.mock';
import {
  createCustomGetLiquidityRequest,
  createDefaultGetLiquidityRequest,
} from '../../interfaces/__mocks__/liquidity-request.mock';
import { LiquidityOrderRepository } from '../../repositories/liquidity-order.repository';
import { LiquidityOrderFactory } from '../liquidity-order.factory';

describe('LiquidityOrderFactory', () => {
  let order: LiquidityOrder;

  let repository: LiquidityOrderRepository;
  let factory: LiquidityOrderFactory;

  let repositoryCreateSpy: jest.SpyInstance;

  beforeEach(() => {
    order = createDefaultLiquidityOrder();
    repository = mock<LiquidityOrderRepository>();
    factory = new LiquidityOrderFactory(repository);

    repositoryCreateSpy = jest.spyOn(repository, 'create').mockImplementation(() => order);
  });

  afterEach(() => {
    repositoryCreateSpy.mockClear();
  });

  describe('#createPurchaseOrder(...)', () => {
    it('sets purchaseStrategy to AssetCategory', () => {
      const entity = factory.createPurchaseOrder(
        createDefaultGetLiquidityRequest(),
        Blockchain.DEFICHAIN,
        AssetCategory.CRYPTO,
      );

      expect(entity.strategy).toBe(AssetCategory.CRYPTO);
    });

    it('calls repo create(...) with correct parameters', () => {
      factory.createPurchaseOrder(
        createCustomGetLiquidityRequest({ targetAsset: createCustomAsset({ dexName: 'TSLA' }) }),
        Blockchain.DEFICHAIN,
        AssetCategory.CRYPTO,
      );

      expect(repositoryCreateSpy).toBeCalledTimes(1);
      expect(repositoryCreateSpy).toBeCalledWith({
        type: LiquidityOrderType.PURCHASE,
        context: LiquidityOrderContext.BUY_CRYPTO,
        correlationId: 'CID_01',
        chain: Blockchain.DEFICHAIN,
        referenceAsset: {
          blockchain: 'DeFiChain',
          category: 'Crypto',
          dexName: 'BTC',
          name: 'dTSLA',
          type: 'Coin',
        },
        referenceAmount: 1,
        targetAsset: createCustomAsset({ dexName: 'TSLA' }),
      });
    });
  });

  describe('#createReservationOrder(...)', () => {
    it('calls repo create(...) with correct parameters', () => {
      factory.createReservationOrder(
        createCustomGetLiquidityRequest({ targetAsset: createCustomAsset({ dexName: 'TSLA' }) }),
        Blockchain.DEFICHAIN,
      );

      expect(repositoryCreateSpy).toBeCalledTimes(1);
      expect(repositoryCreateSpy).toBeCalledWith({
        type: LiquidityOrderType.RESERVATION,
        context: LiquidityOrderContext.BUY_CRYPTO,
        correlationId: 'CID_01',
        chain: Blockchain.DEFICHAIN,
        referenceAsset: {
          blockchain: 'DeFiChain',
          category: 'Crypto',
          dexName: 'BTC',
          name: 'dTSLA',
          type: 'Coin',
        },
        referenceAmount: 1,
        targetAsset: createCustomAsset({ dexName: 'TSLA' }),
      });
    });
  });
});
