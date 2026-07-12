import { BadRequestException } from '@nestjs/common';
import { mock } from 'jest-mock-extended';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { createCustomPayoutOrder } from '../../entities/__mocks__/payout-order.entity.mock';
import { PayoutOrderStatus } from '../../entities/payout-order.entity';
import { PayoutOrderFactory } from '../../factories/payout-order.factory';
import { PayoutOrderRepository } from '../../repositories/payout-order.repository';
import { PayoutStrategy } from '../../strategies/payout/impl/base/payout.strategy';
import { PayoutStrategyRegistry } from '../../strategies/payout/impl/base/payout.strategy-registry';
import { PrepareStrategyRegistry } from '../../strategies/prepare/impl/base/prepare.strategy-registry';
import { PayoutLogService } from '../payout-log.service';
import { PayoutService } from '../payout.service';

describe('PayoutService', () => {
  describe('#speedupTransaction(...)', () => {
    let service: PayoutService;
    let payoutOrderRepo: PayoutOrderRepository;
    let payoutStrategyRegistry: PayoutStrategyRegistry;
    let strategy: PayoutStrategy;

    beforeEach(() => {
      payoutOrderRepo = mock<PayoutOrderRepository>();
      payoutStrategyRegistry = mock<PayoutStrategyRegistry>();
      strategy = mock<PayoutStrategy>();

      jest.spyOn(payoutStrategyRegistry, 'getPayoutStrategy').mockReturnValue(strategy);

      service = new PayoutService(
        mock<PayoutLogService>(),
        mock<NotificationService>(),
        payoutOrderRepo,
        mock<PayoutOrderFactory>(),
        payoutStrategyRegistry,
        mock<PrepareStrategyRegistry>(),
      );
    });

    it('rejects a speedup on an order that has not been broadcast yet (guards against a fresh double-payout)', async () => {
      const order = createCustomPayoutOrder({ id: 1, status: PayoutOrderStatus.PREPARATION_CONFIRMED });
      jest.spyOn(payoutOrderRepo, 'findOneBy').mockResolvedValue(order);

      await expect(service.speedupTransaction(order.id)).rejects.toThrow(BadRequestException);
      expect(strategy.doPayout).not.toBeCalled();
    });

    it('accelerates an already-broadcast (PAYOUT_PENDING) order', async () => {
      const order = createCustomPayoutOrder({
        id: 2,
        status: PayoutOrderStatus.PAYOUT_PENDING,
        payoutTxId: 'PTX_01',
      });
      jest.spyOn(payoutOrderRepo, 'findOneBy').mockResolvedValue(order);

      await service.speedupTransaction(order.id);

      expect(strategy.doPayout).toBeCalledWith([order]);
    });
  });
});
