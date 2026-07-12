import { BadRequestException } from '@nestjs/common';
import { mock } from 'jest-mock-extended';
import * as processServiceModule from 'src/shared/services/process.service';
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
    let doPayoutSpy: jest.Mock;
    let disabledProcessSpy: jest.SpyInstance;

    // supportsSpeedup is a read-only getter; build a plain typed stub instead of a jest-mock-extended
    // proxy so the boolean is deterministic (the proxy would auto-mock the getter to a truthy fn).
    function setupStrategy(supportsSpeedup: boolean): void {
      doPayoutSpy = jest.fn();
      const strategy = { supportsSpeedup, doPayout: doPayoutSpy } as unknown as PayoutStrategy;
      jest.spyOn(payoutStrategyRegistry, 'getPayoutStrategy').mockReturnValue(strategy);
    }

    beforeEach(() => {
      payoutOrderRepo = mock<PayoutOrderRepository>();
      payoutStrategyRegistry = mock<PayoutStrategyRegistry>();

      // TX_SPEEDUP is fail-closed (disabled) by default in tests; enable it so the speedup path runs.
      disabledProcessSpy = jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(false);

      // Default to a speedup-capable (EVM-like) strategy.
      setupStrategy(true);

      service = new PayoutService(
        mock<PayoutLogService>(),
        mock<NotificationService>(),
        payoutOrderRepo,
        mock<PayoutOrderFactory>(),
        payoutStrategyRegistry,
        mock<PrepareStrategyRegistry>(),
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('rejects a speedup on an order that has not been broadcast yet (guards against a fresh double-payout)', async () => {
      const order = createCustomPayoutOrder({ id: 1, status: PayoutOrderStatus.PREPARATION_CONFIRMED });
      jest.spyOn(payoutOrderRepo, 'findOneBy').mockResolvedValue(order);

      await expect(service.speedupTransaction(order.id)).rejects.toThrow(BadRequestException);
      expect(doPayoutSpy).not.toBeCalled();
    });

    it('accelerates an already-broadcast (PAYOUT_PENDING) order on a speedup-capable (EVM) strategy', async () => {
      const order = createCustomPayoutOrder({
        id: 2,
        status: PayoutOrderStatus.PAYOUT_PENDING,
        payoutTxId: 'PTX_01',
      });
      jest.spyOn(payoutOrderRepo, 'findOneBy').mockResolvedValue(order);

      await service.speedupTransaction(order.id);

      expect(doPayoutSpy).toBeCalledWith([order]);
    });

    it('rejects a speedup on a chain without replacement semantics (supportsSpeedup=false) and never broadcasts', async () => {
      setupStrategy(false);
      const order = createCustomPayoutOrder({
        id: 3,
        status: PayoutOrderStatus.PAYOUT_PENDING,
        payoutTxId: 'PTX_02',
      });
      jest.spyOn(payoutOrderRepo, 'findOneBy').mockResolvedValue(order);

      await expect(service.speedupTransaction(order.id)).rejects.toThrow(BadRequestException);
      expect(doPayoutSpy).not.toBeCalled();
    });

    it('rejects a speedup when TX_SPEEDUP is disabled, even on a speedup-capable strategy', async () => {
      disabledProcessSpy.mockReturnValue(true);
      const order = createCustomPayoutOrder({
        id: 4,
        status: PayoutOrderStatus.PAYOUT_PENDING,
        payoutTxId: 'PTX_03',
      });
      jest.spyOn(payoutOrderRepo, 'findOneBy').mockResolvedValue(order);

      await expect(service.speedupTransaction(order.id)).rejects.toThrow(BadRequestException);
      expect(doPayoutSpy).not.toBeCalled();
    });
  });
});
