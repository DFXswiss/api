import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { ScryptOrderInfo, ScryptOrderSide, ScryptOrderStatus } from 'src/integration/exchange/dto/scrypt.dto';
import { ScryptService } from 'src/integration/exchange/services/scrypt.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { LiquidityManagementAction } from '../../../entities/liquidity-management-action.entity';
import { LiquidityManagementOrder } from '../../../entities/liquidity-management-order.entity';
import { LiquidityManagementPipeline } from '../../../entities/liquidity-management-pipeline.entity';
import { LiquidityManagementRule } from '../../../entities/liquidity-management-rule.entity';
import { LiquidityManagementOrderStatus, LiquidityManagementSystem } from '../../../enums';
import { OrderFailedException } from '../../../exceptions/order-failed.exception';
import { OrderNotProcessableException } from '../../../exceptions/order-not-processable.exception';
import { LiquidityManagementOrderRepository } from '../../../repositories/liquidity-management-order.repository';
import { ScryptAdapter, ScryptAdapterCommands } from '../scrypt.adapter';

describe('ScryptAdapter', () => {
  let adapter: ScryptAdapter;

  let scryptService: DeepMocked<ScryptService>;
  let dexService: DeepMocked<DexService>;
  let orderRepo: DeepMocked<LiquidityManagementOrderRepository>;
  let pricingService: DeepMocked<PricingService>;
  let assetService: DeepMocked<AssetService>;

  beforeEach(async () => {
    scryptService = createMock<ScryptService>();
    dexService = createMock<DexService>();
    orderRepo = createMock<LiquidityManagementOrderRepository>();
    pricingService = createMock<PricingService>();
    assetService = createMock<AssetService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        ScryptAdapter,
        { provide: ScryptService, useValue: scryptService },
        { provide: DexService, useValue: dexService },
        { provide: LiquidityManagementOrderRepository, useValue: orderRepo },
        { provide: PricingService, useValue: pricingService },
        { provide: AssetService, useValue: assetService },
      ],
    }).compile();

    adapter = module.get<ScryptAdapter>(ScryptAdapter);

    // happy-path defaults for the sell command (USDT -> CHF)
    assetService.getAssetByUniqueName.mockResolvedValue(createCustomAsset({ name: 'CHF', dexName: 'CHF' }));
    scryptService.getCurrentPrice.mockResolvedValue(1);
    pricingService.getPrice.mockResolvedValue(Price.create('USDT', 'CHF', 1));
    scryptService.getAvailableBalance.mockResolvedValue(1000);
    scryptService.getOrderStatus.mockResolvedValue(null);
    orderRepo.save.mockImplementation(async (order) => order as LiquidityManagementOrder);
  });

  function createOrder(
    command: ScryptAdapterCommands,
    customValues: Partial<LiquidityManagementOrder> = {},
  ): LiquidityManagementOrder {
    const rule = Object.assign(new LiquidityManagementRule(), {
      targetAsset: createCustomAsset({ name: 'USDT', dexName: 'USDT' }),
    });
    const pipeline = Object.assign(new LiquidityManagementPipeline(), { rule });
    const action = Object.assign(new LiquidityManagementAction(), {
      system: LiquidityManagementSystem.SCRYPT,
      command,
      params: JSON.stringify({ tradeAsset: 'CHF' }),
    });

    return Object.assign(new LiquidityManagementOrder(), {
      id: 1,
      created: new Date(),
      status: LiquidityManagementOrderStatus.CREATED,
      minAmount: 10,
      maxAmount: 100,
      pipeline,
      action,
      ...customValues,
    });
  }

  function createSellOrder(customValues: Partial<LiquidityManagementOrder> = {}): LiquidityManagementOrder {
    return createOrder(ScryptAdapterCommands.SELL, customValues);
  }

  function createBuyOrder(customValues: Partial<LiquidityManagementOrder> = {}): LiquidityManagementOrder {
    return createOrder(ScryptAdapterCommands.BUY, customValues);
  }

  function createOrderInfo(id: string): ScryptOrderInfo {
    return {
      id,
      orderId: 'order-1',
      symbol: 'USDT-CHF',
      side: ScryptOrderSide.SELL,
      status: ScryptOrderStatus.FILLED,
      quantity: 100,
      filledQuantity: 100,
      remainingQuantity: 0,
    };
  }

  it('should return the persisted ClOrdID on a transient WS error during sell', async () => {
    const order = createSellOrder();
    scryptService.sell.mockRejectedValue(new Error('Connection closed'));

    const correlationId = await adapter.executeOrder(order);

    expect(correlationId).toEqual(order.correlationId);
    expect(scryptService.sell).toHaveBeenCalledWith('USDT', 'CHF', 100, correlationId);

    // ClOrdID must be persisted before the order is sent
    expect(orderRepo.save).toHaveBeenCalledWith(order);
    expect(orderRepo.save.mock.invocationCallOrder[0]).toBeLessThan(scryptService.sell.mock.invocationCallOrder[0]);
  });

  it('should fail the order on a Scrypt rejection during sell', async () => {
    const order = createSellOrder();
    scryptService.sell.mockRejectedValue(new Error('Scrypt order rejected: invalid order'));

    await expect(adapter.executeOrder(order)).rejects.toThrow(OrderFailedException);
  });

  it('should mark the order as not processable on insufficient funds during sell', async () => {
    const order = createSellOrder();
    scryptService.sell.mockRejectedValue(new Error('Insufficient funds'));

    await expect(adapter.executeOrder(order)).rejects.toThrow(OrderNotProcessableException);
  });

  it('should not place a new order, if the existing ClOrdID is found at Scrypt', async () => {
    const order = createSellOrder({ correlationId: 'existing-id' });
    scryptService.getOrderStatus.mockResolvedValue(createOrderInfo('existing-id'));

    const correlationId = await adapter.executeOrder(order);

    expect(correlationId).toEqual('existing-id');
    expect(scryptService.getOrderStatus).toHaveBeenCalledWith('existing-id');
    expect(scryptService.sell).not.toHaveBeenCalled();
  });

  it('should place a new order and chain the ClOrdID, if the existing ClOrdID is not found at Scrypt', async () => {
    const order = createSellOrder({ correlationId: 'lost-id' });
    scryptService.getOrderStatus.mockResolvedValue(null);
    scryptService.sell.mockImplementation(async (_from, _to, _amount, clOrdId) => clOrdId);

    const correlationId = await adapter.executeOrder(order);

    expect(correlationId).not.toEqual('lost-id');
    expect(correlationId).toEqual(order.correlationId);
    expect(order.previousCorrelationIds).toContain('lost-id');
    expect(scryptService.sell).toHaveBeenCalledWith('USDT', 'CHF', 100, correlationId);
  });

  it('should return the existing trade during sell, even if the balance is locked by the open order', async () => {
    const order = createSellOrder({ correlationId: 'existing-id' });
    scryptService.getOrderStatus.mockResolvedValue(createOrderInfo('existing-id'));
    scryptService.getAvailableBalance.mockResolvedValue(0);

    const correlationId = await adapter.executeOrder(order);

    expect(correlationId).toEqual('existing-id');
    expect(scryptService.sell).not.toHaveBeenCalled();
  });

  it('should return the persisted ClOrdID on a transient WS error during buy', async () => {
    const order = createBuyOrder();
    scryptService.getTradePair.mockResolvedValue({ symbol: 'USDT-CHF', side: ScryptOrderSide.BUY });
    scryptService.sell.mockRejectedValue(new Error('Connection closed'));

    const correlationId = await adapter.executeOrder(order);

    expect(correlationId).toEqual(order.correlationId);
    expect(scryptService.sell).toHaveBeenCalledWith('CHF', 'USDT', 100, correlationId);
  });

  it('should return the persisted ClOrdID on a request timeout during sell', async () => {
    const order = createSellOrder();
    scryptService.sell.mockRejectedValue(new Error('Timeout waiting for ExecutionReport update after 60000ms'));

    const correlationId = await adapter.executeOrder(order);

    expect(correlationId).toEqual(order.correlationId);
    expect(scryptService.sell).toHaveBeenCalledWith('USDT', 'CHF', 100, correlationId);
  });

  it('should return the persisted ClOrdID on a request timeout without update wait during sell', async () => {
    const order = createSellOrder();
    scryptService.sell.mockRejectedValue(new Error('Request timeout after 30000ms'));

    const correlationId = await adapter.executeOrder(order);

    expect(correlationId).toEqual(order.correlationId);
    expect(scryptService.sell).toHaveBeenCalledWith('USDT', 'CHF', 100, correlationId);
  });

  it('should retry the completion check on a request timeout instead of failing the order', async () => {
    const order = createSellOrder({
      status: LiquidityManagementOrderStatus.IN_PROGRESS,
      correlationId: 'existing-id',
      updated: new Date(),
    });
    scryptService.checkTrade.mockRejectedValue(new Error('Request timeout after 30000ms'));

    await expect(adapter.checkCompletion(order)).resolves.toBe(false);
  });

  it('should return the existing ClOrdID, if the re-execution guard fails with a transient error', async () => {
    const order = createSellOrder({ correlationId: 'existing-id' });
    scryptService.getOrderStatus.mockRejectedValue(new Error('Connection closed'));

    const correlationId = await adapter.executeOrder(order);

    expect(correlationId).toEqual('existing-id');
    expect(scryptService.sell).not.toHaveBeenCalled();
  });

  it('should place a new order on a transient guard error, if no ClOrdID exists yet', async () => {
    const order = createSellOrder();
    scryptService.getOrderStatus.mockRejectedValue(new Error('Connection closed'));
    scryptService.sell.mockImplementation(async (_from, _to, _amount, clOrdId) => clOrdId);

    const correlationId = await adapter.executeOrder(order);

    expect(correlationId).toEqual(order.correlationId);
    expect(scryptService.sell).toHaveBeenCalledWith('USDT', 'CHF', 100, correlationId);
  });
});
