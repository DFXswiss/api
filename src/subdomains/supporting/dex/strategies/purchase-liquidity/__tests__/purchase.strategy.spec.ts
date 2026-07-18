import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { createCustomLiquidityOrder } from '../../../entities/__mocks__/liquidity-order.entity.mock';
import { LiquidityOrder } from '../../../entities/liquidity-order.entity';
import { LiquidityOrderFactory } from '../../../factories/liquidity-order.factory';
import { createDefaultGetLiquidityRequest } from '../../../interfaces/__mocks__/liquidity-request.mock';
import { LiquidityOrderRepository } from '../../../repositories/liquidity-order.repository';
import { PurchaseDexService, PurchaseStrategy } from '../impl/base/purchase.strategy';

class TestPurchaseStrategy extends PurchaseStrategy {
  protected readonly logger = new DfxLogger(TestPurchaseStrategy);

  get blockchain(): Blockchain {
    return Blockchain.ETHEREUM;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  get assetCategory(): AssetCategory {
    return AssetCategory.PUBLIC;
  }

  get dexName(): string {
    return undefined;
  }

  protected getFeeAsset(): Promise<Asset> {
    return Promise.resolve(createDefaultAsset());
  }
}

describe('PurchaseStrategy', () => {
  let strategy: TestPurchaseStrategy;
  let dexService: PurchaseDexService;
  let liquidityOrderRepo: LiquidityOrderRepository;
  let liquidityOrderFactory: LiquidityOrderFactory;
  let order: LiquidityOrder;
  let saveSpy: jest.SpyInstance;
  let swapSpy: jest.SpyInstance;
  let estimateSpy: jest.SpyInstance;

  beforeEach(() => {
    dexService = mock<PurchaseDexService>();
    liquidityOrderRepo = mock<LiquidityOrderRepository>();
    liquidityOrderFactory = mock<LiquidityOrderFactory>();
    order = createCustomLiquidityOrder({ id: 42, txId: undefined, swapAsset: undefined, swapAmount: undefined });

    jest.spyOn(liquidityOrderFactory, 'createPurchaseOrder').mockReturnValue(order);
    saveSpy = jest.spyOn(liquidityOrderRepo, 'save').mockImplementation(async (entity) => entity as LiquidityOrder);
    swapSpy = jest.spyOn(dexService, 'swap').mockResolvedValue('SWAP_TX_01');
    estimateSpy = jest.spyOn(dexService, 'getTargetAmount').mockResolvedValue(2);

    strategy = new TestPurchaseStrategy(dexService);
    Object.assign(strategy, { liquidityOrderRepo, liquidityOrderFactory });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('persists the in-flight order before dispatching the swap', async () => {
    await strategy.purchaseLiquidity(createDefaultGetLiquidityRequest());

    expect(saveSpy.mock.invocationCallOrder[0]).toBeLessThan(swapSpy.mock.invocationCallOrder[0]);
  });

  it('cancels and persists the order when swap booking fails before the broadcast boundary', async () => {
    const error = new Error('route lookup failed');
    const cancelSpy = jest.spyOn(order, 'cancel');
    swapSpy.mockRejectedValue(error);

    await expect(strategy.purchaseLiquidity(createDefaultGetLiquidityRequest())).rejects.toBe(error);

    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(order.isComplete).toBe(true);
    expect(saveSpy).toHaveBeenCalledTimes(2);
    expect(saveSpy).toHaveBeenLastCalledWith(order);
  });

  it('keeps the order in-flight when swap dispatch fails ambiguously', async () => {
    const error = new TxBroadcastError('send result unknown');
    const cancelSpy = jest.spyOn(order, 'cancel');
    swapSpy.mockRejectedValue(error);

    await expect(strategy.purchaseLiquidity(createDefaultGetLiquidityRequest())).rejects.toBe(error);

    expect(cancelSpy).not.toHaveBeenCalled();
    expect(order.isComplete).toBe(false);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('persists the transaction ID immediately after a successful swap and before estimation', async () => {
    const persistedTxIds: string[] = [];
    saveSpy.mockImplementation(async (entity: LiquidityOrder) => {
      persistedTxIds.push(entity.txId);
      return entity;
    });
    await strategy.purchaseLiquidity(createDefaultGetLiquidityRequest());

    expect(persistedTxIds).toEqual([undefined, 'SWAP_TX_01', 'SWAP_TX_01']);
    expect(saveSpy.mock.invocationCallOrder[1]).toBeLessThan(estimateSpy.mock.invocationCallOrder[0]);
  });

  it('leaves the persisted transaction ID in-flight when post-swap estimation fails', async () => {
    const persistedTxIds: string[] = [];
    const cancelSpy = jest.spyOn(order, 'cancel');
    saveSpy.mockImplementation(async (entity: LiquidityOrder) => {
      persistedTxIds.push(entity.txId);
      return entity;
    });
    estimateSpy.mockRejectedValue(new Error('quote unavailable'));

    await expect(strategy.purchaseLiquidity(createDefaultGetLiquidityRequest())).rejects.toThrow('quote unavailable');

    expect(persistedTxIds).toEqual([undefined, 'SWAP_TX_01']);
    expect(cancelSpy).not.toHaveBeenCalled();
    expect(order.isComplete).toBe(false);
  });
});
