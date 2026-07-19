import { mock } from 'jest-mock-extended';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { LessThan } from 'typeorm';
import { createCustomLiquidityOrder } from '../../entities/__mocks__/liquidity-order.entity.mock';
import { LiquidityOrderContext, LiquidityOrderType } from '../../entities/liquidity-order.entity';
import { LiquidityOrderFactory } from '../../factories/liquidity-order.factory';
import { LiquidityOrderRepository } from '../../repositories/liquidity-order.repository';
import { CheckLiquidityStrategyRegistry } from '../../strategies/check-liquidity/impl/base/check-liquidity.strategy-registry';
import { PurchaseLiquidityStrategyRegistry } from '../../strategies/purchase-liquidity/impl/base/purchase-liquidity.strategy-registry';
import { SellLiquidityStrategyRegistry } from '../../strategies/sell-liquidity/impl/base/sell-liquidity.strategy-registry';
import { SupplementaryStrategyRegistry } from '../../strategies/supplementary/impl/base/supplementary.strategy-registry';
import { DexService } from '../dex.service';

describe('DexService', () => {
  let service: DexService;
  let liquidityOrderRepo: LiquidityOrderRepository;
  let notificationService: NotificationService;

  beforeEach(() => {
    liquidityOrderRepo = mock<LiquidityOrderRepository>();
    notificationService = mock<NotificationService>();

    service = new DexService(
      mock<CheckLiquidityStrategyRegistry>(),
      mock<PurchaseLiquidityStrategyRegistry>(),
      mock<SellLiquidityStrategyRegistry>(),
      mock<SupplementaryStrategyRegistry>(),
      liquidityOrderRepo,
      mock<LiquidityOrderFactory>(),
      notificationService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('selects all stranded purchases and sends one debounced mail grouped by transaction state', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-16T12:00:00.000Z'));
    const orders = [
      createCustomLiquidityOrder({ id: 9, txId: undefined }),
      createCustomLiquidityOrder({ id: 3, txId: 'TX_03' }),
      createCustomLiquidityOrder({ id: 4, txId: undefined }),
      createCustomLiquidityOrder({ id: 8, txId: 'TX_08' }),
    ];
    const findSpy = jest.spyOn(liquidityOrderRepo, 'find').mockResolvedValue(orders);
    const sendMailSpy = jest.spyOn(notificationService, 'sendMail').mockResolvedValue(undefined);

    await service['alertStrandedPurchaseOrders']();

    expect(findSpy).toHaveBeenCalledWith({
      where: {
        type: LiquidityOrderType.PURCHASE,
        isComplete: false,
        isReady: false,
        created: LessThan(new Date('2026-07-16T11:45:00.000Z')),
      },
      select: { id: true, txId: true },
      loadEagerRelations: false,
    });
    expect(sendMailSpy).toHaveBeenCalledTimes(1);
    expect(sendMailSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          errors: [
            'Purchase liquidity orders have no transaction ID after 15 minutes — verify on-chain absence before cancelling: 4, 9',
            'Purchase liquidity orders were dispatched but never completed — reconcile/complete manually; retries are blocked by the in-flight guard: 3, 8',
          ],
        }),
        options: { debounce: 3600000 },
      }),
    );
  });

  it('fetches the newest order when returning a liquidity transaction result', async () => {
    const order = createCustomLiquidityOrder({ id: 7, targetAmount: 5 });
    const findOneSpy = jest.spyOn(liquidityOrderRepo, 'findOne').mockResolvedValue(order);

    const result = await service.fetchLiquidityTransactionResult(LiquidityOrderContext.BUY_CRYPTO, 'CID_01');

    expect(findOneSpy).toHaveBeenCalledWith({
      where: { context: LiquidityOrderContext.BUY_CRYPTO, correlationId: 'CID_01' },
      order: { id: 'DESC' },
    });
    expect(result.target.amount).toBe(5);
  });

  it('checks readiness on the newest order', async () => {
    const order = createCustomLiquidityOrder({ id: 7, isReady: true, txId: 'TX_07' });
    const findOneSpy = jest.spyOn(liquidityOrderRepo, 'findOne').mockResolvedValue(order);

    const result = await service.checkOrderReady(LiquidityOrderContext.BUY_CRYPTO, 'CID_01');

    expect(findOneSpy).toHaveBeenCalledWith({
      where: { context: LiquidityOrderContext.BUY_CRYPTO, correlationId: 'CID_01' },
      order: { id: 'DESC' },
    });
    expect(result).toEqual(expect.objectContaining({ isReady: true, purchaseTxId: 'TX_07' }));
  });

  it('checks completion on the newest order without excluding completed rows', async () => {
    const order = createCustomLiquidityOrder({ id: 7, isComplete: true, txId: 'TX_07' });
    const findOneSpy = jest.spyOn(liquidityOrderRepo, 'findOne').mockResolvedValue(order);

    const result = await service.checkOrderCompletion(LiquidityOrderContext.BUY_CRYPTO, 'CID_01');

    expect(findOneSpy).toHaveBeenCalledWith({
      where: { context: LiquidityOrderContext.BUY_CRYPTO, correlationId: 'CID_01' },
      order: { id: 'DESC' },
    });
    expect(result).toEqual({ isComplete: true, purchaseTxId: 'TX_07' });
  });
});
