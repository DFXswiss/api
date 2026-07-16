import { mock } from 'jest-mock-extended';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { IsNull, LessThan } from 'typeorm';
import { createCustomLiquidityOrder } from '../../entities/__mocks__/liquidity-order.entity.mock';
import { LiquidityOrderType } from '../../entities/liquidity-order.entity';
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

  it('selects stranded purchases and sends one debounced mail listing their IDs', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-16T12:00:00.000Z'));
    const orders = [createCustomLiquidityOrder({ id: 9 }), createCustomLiquidityOrder({ id: 4 })];
    const findBySpy = jest.spyOn(liquidityOrderRepo, 'findBy').mockResolvedValue(orders);
    const sendMailSpy = jest.spyOn(notificationService, 'sendMail').mockResolvedValue(undefined);

    await service['alertStrandedPurchaseOrders']();

    expect(findBySpy).toHaveBeenCalledWith({
      type: LiquidityOrderType.PURCHASE,
      isComplete: false,
      txId: IsNull(),
      created: LessThan(new Date('2026-07-16T11:45:00.000Z')),
    });
    expect(sendMailSpy).toHaveBeenCalledTimes(1);
    expect(sendMailSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ errors: [expect.stringContaining('4, 9')] }),
        options: { debounce: 3600000 },
      }),
    );
  });
});
