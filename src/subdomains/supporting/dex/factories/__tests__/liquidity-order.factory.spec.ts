import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetCategory } from 'src/shared/models/asset/asset.entity';
import { createDefaultLiquidityOrder } from '../../entities/__mocks__/liquidity-order.entity.mock';
import { LiquidityOrder, LiquidityOrderContext, LiquidityOrderType } from '../../entities/liquidity-order.entity';
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
        AssetCategory.PUBLIC,
      );

      expect(entity.strategy).toBe(AssetCategory.PUBLIC);
    });

    it('calls repo create(...) with correct parameters', () => {
      factory.createPurchaseOrder(
        createCustomGetLiquidityRequest({ targetAsset: createCustomAsset({ dexName: 'USDT' }) }),
        Blockchain.ETHEREUM,
        AssetCategory.PUBLIC,
      );

      expect(repositoryCreateSpy).toBeCalledTimes(1);
      expect(repositoryCreateSpy).toBeCalledWith({
        type: LiquidityOrderType.PURCHASE,
        context: LiquidityOrderContext.BUY_CRYPTO,
        correlationId: 'CID_01',
        chain: Blockchain.ETHEREUM,
        referenceAsset: {
          blockchain: 'Ethereum',
          category: 'Public',
          dexName: 'BTC',
          name: 'USDT',
          type: 'Token',
          refundEnabled: true,
        },
        referenceAmount: 1,
        targetAsset: createCustomAsset({ dexName: 'USDT' }),
      });
    });
  });

  describe('#createReservationOrder(...)', () => {
    it('calls repo create(...) with correct parameters', () => {
      factory.createReservationOrder(
        createCustomGetLiquidityRequest({ targetAsset: createCustomAsset({ dexName: 'BTC' }) }),
        Blockchain.ETHEREUM,
      );

      expect(repositoryCreateSpy).toBeCalledTimes(1);
      expect(repositoryCreateSpy).toBeCalledWith({
        type: LiquidityOrderType.RESERVATION,
        context: LiquidityOrderContext.BUY_CRYPTO,
        correlationId: 'CID_01',
        chain: Blockchain.ETHEREUM,
        referenceAsset: {
          blockchain: 'Ethereum',
          category: 'Public',
          dexName: 'BTC',
          name: 'USDT',
          type: 'Token',
          refundEnabled: true,
        },
        referenceAmount: 1,
        targetAsset: createCustomAsset({ dexName: 'BTC' }),
      });
    });
  });
});
