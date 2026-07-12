import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mock } from 'jest-mock-extended';
import * as processServiceModule from 'src/shared/services/process.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { createCustomPayoutOrder } from '../../entities/__mocks__/payout-order.entity.mock';
import { PayoutOrder, PayoutOrderStatus } from '../../entities/payout-order.entity';
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
      expect(doPayoutSpy).not.toHaveBeenCalled();
    });

    it('accelerates an already-broadcast (PAYOUT_PENDING) order on a speedup-capable (EVM) strategy', async () => {
      const order = createCustomPayoutOrder({
        id: 2,
        status: PayoutOrderStatus.PAYOUT_PENDING,
        payoutTxId: 'PTX_01',
      });
      jest.spyOn(payoutOrderRepo, 'findOneBy').mockResolvedValue(order);

      await service.speedupTransaction(order.id);

      expect(doPayoutSpy).toHaveBeenCalledWith([order]);
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
      expect(doPayoutSpy).not.toHaveBeenCalled();
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
      expect(doPayoutSpy).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown order id and never consults the strategy registry', async () => {
      const getStrategySpy = jest.spyOn(payoutStrategyRegistry, 'getPayoutStrategy');
      jest.spyOn(payoutOrderRepo, 'findOneBy').mockResolvedValue(null);

      await expect(service.speedupTransaction(999)).rejects.toThrow(NotFoundException);
      expect(getStrategySpy).not.toHaveBeenCalled();
      expect(doPayoutSpy).not.toHaveBeenCalled();
    });
  });

  describe('#processOrders(...) — cron-level reboot guarantee', () => {
    let service: PayoutService;
    let payoutOrderRepo: PayoutOrderRepository;
    let payoutStrategyRegistry: PayoutStrategyRegistry;
    let notificationService: NotificationService;
    let doPayoutSpy: jest.Mock;

    // Dispatches payoutOrderRepo.findBy(...) by the status it was queried with, mirroring the
    // distinct status-scoped queries each cron sub-step (checkExistingOrders/payoutOrders/
    // processFailedOrders) issues against the same table.
    function mockFindByStatus(map: Partial<Record<PayoutOrderStatus, PayoutOrder[]>>): void {
      jest.spyOn(payoutOrderRepo, 'findBy').mockImplementation(async (where: { status?: PayoutOrderStatus }) => {
        return (where.status && map[where.status]) ?? [];
      });
    }

    beforeEach(() => {
      payoutOrderRepo = mock<PayoutOrderRepository>();
      payoutStrategyRegistry = mock<PayoutStrategyRegistry>();
      notificationService = mock<NotificationService>();

      // getLatestOrderDate() resolves to "now" so the debounce (waitForStableInput) is NOT yet
      // elapsed: prepareNewOrders() returns early and never queries findBy({status: CREATED}),
      // which is irrelevant to the reboot guarantee under test here.
      jest.spyOn(payoutOrderRepo, 'findOne').mockResolvedValue({ created: new Date() } as PayoutOrder);
      jest.spyOn(payoutOrderRepo, 'save').mockImplementation(async (o) => o as PayoutOrder);

      doPayoutSpy = jest.fn();
      const strategy = { supportsSpeedup: false, doPayout: doPayoutSpy } as unknown as PayoutStrategy;
      jest.spyOn(payoutStrategyRegistry, 'getPayoutStrategy').mockReturnValue(strategy);

      service = new PayoutService(
        mock<PayoutLogService>(),
        notificationService,
        payoutOrderRepo,
        mock<PayoutOrderFactory>(),
        payoutStrategyRegistry,
        mock<PrepareStrategyRegistry>(),
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('dispatches only PREPARATION_CONFIRMED orders to doPayout; a crashed PAYOUT_DESIGNATED order is skipped', async () => {
      const confirmedOrder = createCustomPayoutOrder({ id: 10, status: PayoutOrderStatus.PREPARATION_CONFIRMED });
      const crashedOrder = createCustomPayoutOrder({ id: 11, status: PayoutOrderStatus.PAYOUT_DESIGNATED });

      mockFindByStatus({
        [PayoutOrderStatus.PREPARATION_PENDING]: [],
        [PayoutOrderStatus.PAYOUT_PENDING]: [],
        [PayoutOrderStatus.PREPARATION_CONFIRMED]: [confirmedOrder],
        [PayoutOrderStatus.PAYOUT_DESIGNATED]: [crashedOrder],
      });

      await service.processOrders();

      expect(doPayoutSpy).toHaveBeenCalledTimes(1);
      expect(doPayoutSpy).toHaveBeenCalledWith([confirmedOrder]);
      expect(doPayoutSpy).not.toHaveBeenCalledWith(expect.arrayContaining([crashedOrder]));
    });

    it('processFailedOrders marks a stuck order PAYOUT_UNCERTAIN, persists it and alerts via mail (no doPayout)', async () => {
      const crashedOrder = createCustomPayoutOrder({ id: 12, status: PayoutOrderStatus.PAYOUT_DESIGNATED });
      const saveSpy = jest.spyOn(payoutOrderRepo, 'save');
      const sendMailSpy = jest.spyOn(notificationService, 'sendMail').mockResolvedValue(undefined);
      jest.spyOn(payoutOrderRepo, 'findBy').mockResolvedValue([crashedOrder]);

      await service['processFailedOrders']();

      expect(crashedOrder.status).toBe(PayoutOrderStatus.PAYOUT_UNCERTAIN);
      expect(saveSpy).toHaveBeenCalledWith(crashedOrder);
      expect(sendMailSpy).toHaveBeenCalledTimes(1);
      expect(doPayoutSpy).not.toHaveBeenCalled();
    });

    describe('#payoutOrders(...)', () => {
      it('queries PREPARATION_CONFIRMED orders, resolves a strategy per order and dispatches doPayout with the grouped orders', async () => {
        const confirmedOrder = createCustomPayoutOrder({ id: 20, status: PayoutOrderStatus.PREPARATION_CONFIRMED });
        const findBySpy = jest.spyOn(payoutOrderRepo, 'findBy').mockResolvedValue([confirmedOrder]);
        const getStrategySpy = jest.spyOn(payoutStrategyRegistry, 'getPayoutStrategy');

        await service['payoutOrders']();

        expect(findBySpy).toHaveBeenCalledWith({ status: PayoutOrderStatus.PREPARATION_CONFIRMED });
        expect(getStrategySpy).toHaveBeenCalledWith(confirmedOrder.asset);
        expect(doPayoutSpy).toHaveBeenCalledTimes(1);
        expect(doPayoutSpy).toHaveBeenCalledWith([confirmedOrder]);
      });

      it('skips an order without a resolvable strategy and logs a warning (groupByStrategies branch)', async () => {
        const orphanOrder = createCustomPayoutOrder({ id: 21, status: PayoutOrderStatus.PREPARATION_CONFIRMED });
        jest.spyOn(payoutOrderRepo, 'findBy').mockResolvedValue([orphanOrder]);
        jest.spyOn(payoutStrategyRegistry, 'getPayoutStrategy').mockReturnValue(undefined);
        const warnSpy = jest.spyOn(service['logger'], 'warn');

        await service['payoutOrders']();

        expect(doPayoutSpy).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`for payout order ID ${orphanOrder.id}`));
      });
    });

    describe('#processFailedOrders(...)', () => {
      it('does nothing when there is no PAYOUT_DESIGNATED order (no mail, no save)', async () => {
        const findBySpy = jest.spyOn(payoutOrderRepo, 'findBy').mockResolvedValue([]);
        const saveSpy = jest.spyOn(payoutOrderRepo, 'save');
        const sendMailSpy = jest.spyOn(notificationService, 'sendMail');

        await service['processFailedOrders']();

        expect(findBySpy).toHaveBeenCalledWith({ status: PayoutOrderStatus.PAYOUT_DESIGNATED });
        expect(sendMailSpy).not.toHaveBeenCalled();
        expect(saveSpy).not.toHaveBeenCalled();
      });
    });
  });
});
