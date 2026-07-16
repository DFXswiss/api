import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mock } from 'jest-mock-extended';
import { createCustomAsset, createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import * as processServiceModule from 'src/shared/services/process.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { In, MoreThan } from 'typeorm';
import { createCustomPayoutOrder } from '../../entities/__mocks__/payout-order.entity.mock';
import { PayoutOrder, PayoutOrderContext, PayoutOrderStatus } from '../../entities/payout-order.entity';
import { PayoutOrderFactory } from '../../factories/payout-order.factory';
import { PayoutRequest } from '../../interfaces';
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
      jest.spyOn(payoutOrderRepo, 'update').mockResolvedValue({ affected: 1 } as any);
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

    it('processFailedOrders conditionally escalates a stuck order and alerts via mail (no stale save)', async () => {
      const crashedOrder = createCustomPayoutOrder({ id: 12, status: PayoutOrderStatus.PAYOUT_DESIGNATED });
      const pendingInvestigationSpy = jest.spyOn(crashedOrder, 'pendingInvestigation');
      const updateSpy = jest.spyOn(payoutOrderRepo, 'update');
      const saveSpy = jest.spyOn(payoutOrderRepo, 'save');
      const sendMailSpy = jest.spyOn(notificationService, 'sendMail').mockResolvedValue(undefined);
      jest.spyOn(payoutOrderRepo, 'findBy').mockResolvedValue([crashedOrder]);

      await service['processFailedOrders']();

      expect(updateSpy).toHaveBeenCalledWith(
        { id: crashedOrder.id, status: PayoutOrderStatus.PAYOUT_DESIGNATED },
        { status: PayoutOrderStatus.PAYOUT_UNCERTAIN },
      );
      expect(pendingInvestigationSpy).not.toHaveBeenCalled();
      expect(saveSpy).not.toHaveBeenCalled();
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

      it('isolates a throwing payout strategy: logs the error and continues without crashing the cron step (catch branch)', async () => {
        const confirmedOrder = createCustomPayoutOrder({ id: 22, status: PayoutOrderStatus.PREPARATION_CONFIRMED });
        jest.spyOn(payoutOrderRepo, 'findBy').mockResolvedValue([confirmedOrder]);
        const throwingDoPayout = jest.fn().mockRejectedValue(new Error('boom'));
        jest
          .spyOn(payoutStrategyRegistry, 'getPayoutStrategy')
          .mockReturnValue({ doPayout: throwingDoPayout } as unknown as PayoutStrategy);
        const errorSpy = jest.spyOn(service['logger'], 'error');

        await expect(service['payoutOrders']()).resolves.toBeUndefined();

        expect(throwingDoPayout).toHaveBeenCalledWith([confirmedOrder]);
        expect(errorSpy).toHaveBeenCalled();
      });

      it('isolates a throwing payout-strategy group from a second, healthy strategy group (cross-group isolation)', async () => {
        const assetA = createCustomAsset({ id: 201 });
        const assetB = createCustomAsset({ id: 202 });
        const orderA = createCustomPayoutOrder({
          id: 23,
          status: PayoutOrderStatus.PREPARATION_CONFIRMED,
          asset: assetA,
        });
        const orderB = createCustomPayoutOrder({
          id: 24,
          status: PayoutOrderStatus.PREPARATION_CONFIRMED,
          asset: assetB,
        });
        jest.spyOn(payoutOrderRepo, 'findBy').mockResolvedValue([orderA, orderB]);

        const throwingDoPayout = jest.fn().mockRejectedValue(new Error('boom'));
        const healthyDoPayout = jest.fn().mockResolvedValue(undefined);
        jest.spyOn(payoutStrategyRegistry, 'getPayoutStrategy').mockImplementation((asset) => {
          if (asset === assetA) return { doPayout: throwingDoPayout } as unknown as PayoutStrategy;
          if (asset === assetB) return { doPayout: healthyDoPayout } as unknown as PayoutStrategy;
          return undefined;
        });
        const errorSpy = jest.spyOn(service['logger'], 'error');

        await expect(service['payoutOrders']()).resolves.toBeUndefined();

        expect(throwingDoPayout).toHaveBeenCalledWith([orderA]);
        // group B's doPayout still runs despite group A's throw: proves catch-isolation across groups, not merely within one
        expect(healthyDoPayout).toHaveBeenCalledWith([orderB]);
        expect(errorSpy).toHaveBeenCalled();
      });
    });

    describe('#processFailedOrders(...)', () => {
      it('does nothing when there is no PAYOUT_DESIGNATED order (no update, mail or save)', async () => {
        const findBySpy = jest.spyOn(payoutOrderRepo, 'findBy').mockResolvedValue([]);
        const updateSpy = jest.spyOn(payoutOrderRepo, 'update');
        const saveSpy = jest.spyOn(payoutOrderRepo, 'save');
        const sendMailSpy = jest.spyOn(notificationService, 'sendMail');

        await service['processFailedOrders']();

        expect(findBySpy).toHaveBeenCalledWith({ status: PayoutOrderStatus.PAYOUT_DESIGNATED });
        expect(updateSpy).not.toHaveBeenCalled();
        expect(sendMailSpy).not.toHaveBeenCalled();
        expect(saveSpy).not.toHaveBeenCalled();
      });

      it('mails and logs only orders whose conditional escalation succeeds', async () => {
        const escalatedOrder = createCustomPayoutOrder({ id: 30, status: PayoutOrderStatus.PAYOUT_DESIGNATED });
        const movedOrder = createCustomPayoutOrder({ id: 31, status: PayoutOrderStatus.PAYOUT_DESIGNATED });
        jest.spyOn(payoutOrderRepo, 'findBy').mockResolvedValue([escalatedOrder, movedOrder]);
        jest
          .spyOn(payoutOrderRepo, 'update')
          .mockResolvedValueOnce({ affected: 1 } as any)
          .mockResolvedValueOnce({ affected: 0 } as any);
        const logFailedOrdersSpy = jest
          .spyOn(service['logs'], 'logFailedOrders')
          .mockReturnValue('Escalated payout order');
        const sendMailSpy = jest.spyOn(notificationService, 'sendMail').mockResolvedValue(undefined);
        const saveSpy = jest.spyOn(payoutOrderRepo, 'save');

        await service['processFailedOrders']();

        expect(logFailedOrdersSpy).toHaveBeenCalledWith([escalatedOrder]);
        expect(sendMailSpy).toHaveBeenCalledTimes(1);
        expect(sendMailSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            correlationId: expect.stringContaining(`|${escalatedOrder.id}&${escalatedOrder.context}|`),
          }),
        );
        expect(sendMailSpy).not.toHaveBeenCalledWith(
          expect.objectContaining({ correlationId: expect.stringContaining(`|${movedOrder.id}&${movedOrder.context}|`) }),
        );
        expect(saveSpy).not.toHaveBeenCalled();
      });

      it('does not mail when every conditional escalation loses to a concurrent state change', async () => {
        const movedOrder = createCustomPayoutOrder({ id: 32, status: PayoutOrderStatus.PAYOUT_DESIGNATED });
        jest.spyOn(payoutOrderRepo, 'findBy').mockResolvedValue([movedOrder]);
        jest.spyOn(payoutOrderRepo, 'update').mockResolvedValueOnce({ affected: 0 } as any);
        const logFailedOrdersSpy = jest.spyOn(service['logs'], 'logFailedOrders');
        const sendMailSpy = jest.spyOn(notificationService, 'sendMail');
        const infoSpy = jest.spyOn(service['logger'], 'info');

        await service['processFailedOrders']();

        expect(infoSpy).toHaveBeenCalledWith(
          `Skipping failed payout order ${movedOrder.id}: state changed concurrently`,
        );
        expect(logFailedOrdersSpy).not.toHaveBeenCalled();
        expect(sendMailSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe('#getPayoutOrders(...)', () => {
    let service: PayoutService;
    let payoutOrderRepo: PayoutOrderRepository;

    beforeEach(() => {
      payoutOrderRepo = mock<PayoutOrderRepository>();

      service = new PayoutService(
        mock<PayoutLogService>(),
        mock<NotificationService>(),
        payoutOrderRepo,
        mock<PayoutOrderFactory>(),
        mock<PayoutStrategyRegistry>(),
        mock<PrepareStrategyRegistry>(),
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('queries orders created after the given date and forwards the requested relations', async () => {
      const from = new Date('2026-01-01');
      const relations = { asset: true };
      const orders = [createCustomPayoutOrder({ id: 100 })];
      const findSpy = jest.spyOn(payoutOrderRepo, 'find').mockResolvedValue(orders);

      const result = await service.getPayoutOrders(from, relations);

      expect(findSpy).toHaveBeenCalledWith({ where: { created: MoreThan(from) }, relations });
      expect(result).toBe(orders);
    });

    it('queries orders without relations when none are provided', async () => {
      const from = new Date('2026-01-01');
      const findSpy = jest.spyOn(payoutOrderRepo, 'find').mockResolvedValue([]);

      await service.getPayoutOrders(from);

      expect(findSpy).toHaveBeenCalledWith({ where: { created: MoreThan(from) }, relations: undefined });
    });
  });

  describe('#doPayout(...)', () => {
    let service: PayoutService;
    let payoutOrderRepo: PayoutOrderRepository;
    let payoutOrderFactory: PayoutOrderFactory;
    let disabledProcessSpy: jest.SpyInstance;

    const baseRequest: PayoutRequest = {
      context: PayoutOrderContext.BUY_CRYPTO,
      correlationId: 'CID_99',
      asset: createDefaultAsset(),
      amount: 5,
      destinationAddress: 'ADDR_99',
    };

    beforeEach(() => {
      payoutOrderRepo = mock<PayoutOrderRepository>();
      payoutOrderFactory = mock<PayoutOrderFactory>();

      // CRYPTO_PAYOUT is fail-closed (disabled) by default in tests; enable it so the happy path runs.
      disabledProcessSpy = jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(false);

      service = new PayoutService(
        mock<PayoutLogService>(),
        mock<NotificationService>(),
        payoutOrderRepo,
        payoutOrderFactory,
        mock<PayoutStrategyRegistry>(),
        mock<PrepareStrategyRegistry>(),
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('creates and persists a new payout order when the process is enabled and the amount is valid', async () => {
      const order = createCustomPayoutOrder({ id: 101 });
      const createSpy = jest.spyOn(payoutOrderFactory, 'createOrder').mockReturnValue(order);
      const saveSpy = jest.spyOn(payoutOrderRepo, 'save').mockResolvedValue(order);

      await service.doPayout(baseRequest);

      expect(createSpy).toHaveBeenCalledWith(baseRequest);
      expect(saveSpy).toHaveBeenCalledWith(order);
    });

    it('accepts a zero-amount payout (boundary of the amount >= 0 guard)', async () => {
      const zeroRequest = { ...baseRequest, amount: 0 };
      const order = createCustomPayoutOrder({ id: 102, amount: 0 });
      jest.spyOn(payoutOrderFactory, 'createOrder').mockReturnValue(order);
      const saveSpy = jest.spyOn(payoutOrderRepo, 'save').mockResolvedValue(order);

      await service.doPayout(zeroRequest);

      expect(saveSpy).toHaveBeenCalledWith(order);
    });

    it('rejects with a generic error and logs when CRYPTO_PAYOUT is disabled (fail-closed)', async () => {
      disabledProcessSpy.mockReturnValue(true);
      const saveSpy = jest.spyOn(payoutOrderRepo, 'save');
      const errorSpy = jest.spyOn(service['logger'], 'error');

      await expect(service.doPayout(baseRequest)).rejects.toThrow(
        `Error while trying to create PayoutOrder for context ${baseRequest.context} and correlationId: ${baseRequest.correlationId}`,
      );

      expect(saveSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });

    it('rejects with a generic error and logs when the requested amount is negative', async () => {
      const negativeRequest = { ...baseRequest, amount: -1 };
      const saveSpy = jest.spyOn(payoutOrderRepo, 'save');
      const errorSpy = jest.spyOn(service['logger'], 'error');

      await expect(service.doPayout(negativeRequest)).rejects.toThrow(
        `Error while trying to create PayoutOrder for context ${negativeRequest.context} and correlationId: ${negativeRequest.correlationId}`,
      );

      expect(saveSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('#checkOrderCompletion(...)', () => {
    let service: PayoutService;
    let payoutOrderRepo: PayoutOrderRepository;

    beforeEach(() => {
      payoutOrderRepo = mock<PayoutOrderRepository>();

      service = new PayoutService(
        mock<PayoutLogService>(),
        mock<NotificationService>(),
        payoutOrderRepo,
        mock<PayoutOrderFactory>(),
        mock<PayoutStrategyRegistry>(),
        mock<PrepareStrategyRegistry>(),
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('reports isComplete=true with the payout details for a COMPLETE order', async () => {
      const order = createCustomPayoutOrder({
        id: 110,
        status: PayoutOrderStatus.COMPLETE,
        payoutTxId: 'PTX_110',
        amount: 3,
      });
      jest.spyOn(payoutOrderRepo, 'findOneBy').mockResolvedValue(order);

      const result = await service.checkOrderCompletion(order.context, order.correlationId);

      expect(result.isComplete).toBe(true);
      expect(result.payoutTxId).toBe('PTX_110');
      expect(result.payoutAmount).toBe(3);
      expect(result.payoutAsset).toBe(order.asset);
      expect(result.payoutFee).toEqual(order.payoutFee);
    });

    it('reports isComplete=false for an order found in a non-COMPLETE status', async () => {
      const order = createCustomPayoutOrder({ id: 111, status: PayoutOrderStatus.PAYOUT_PENDING });
      jest.spyOn(payoutOrderRepo, 'findOneBy').mockResolvedValue(order);

      const result = await service.checkOrderCompletion(order.context, order.correlationId);

      expect(result.isComplete).toBe(false);
    });

    it('returns falsy fields when no matching order exists', async () => {
      jest.spyOn(payoutOrderRepo, 'findOneBy').mockResolvedValue(null);

      const result = await service.checkOrderCompletion(PayoutOrderContext.BUY_CRYPTO, 'UNKNOWN');

      expect(result.isComplete).toBeFalsy();
      expect(result.payoutTxId).toBeFalsy();
      expect(result.payoutFee).toBeFalsy();
      expect(result.payoutAmount).toBeFalsy();
      expect(result.payoutAsset).toBeFalsy();
    });
  });

  describe('#estimateFee(...) / #estimateBlockchainFee(...)', () => {
    let service: PayoutService;
    let payoutStrategyRegistry: PayoutStrategyRegistry;
    let prepareStrategyRegistry: PrepareStrategyRegistry;

    beforeEach(() => {
      payoutStrategyRegistry = mock<PayoutStrategyRegistry>();
      prepareStrategyRegistry = mock<PrepareStrategyRegistry>();

      service = new PayoutService(
        mock<PayoutLogService>(),
        mock<NotificationService>(),
        mock<PayoutOrderRepository>(),
        mock<PayoutOrderFactory>(),
        payoutStrategyRegistry,
        prepareStrategyRegistry,
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('combines the prepare fee and the payout fee into a single rounded total fee', async () => {
      const targetAsset = createDefaultAsset();
      const asset = createDefaultAsset();
      const feeAsset = createDefaultAsset();

      const prepareEstimateSpy = jest.fn().mockResolvedValue({ asset: feeAsset, amount: 0.1 });
      const payoutEstimateSpy = jest.fn().mockResolvedValue({ asset: feeAsset, amount: 0.2 });

      jest
        .spyOn(prepareStrategyRegistry, 'getPrepareStrategy')
        .mockReturnValue({ estimateFee: prepareEstimateSpy } as any);
      jest
        .spyOn(payoutStrategyRegistry, 'getPayoutStrategy')
        .mockReturnValue({ estimateFee: payoutEstimateSpy } as any);

      const result = await service.estimateFee(targetAsset, 'ADDR', 1, asset);

      expect(prepareEstimateSpy).toHaveBeenCalledWith(targetAsset);
      expect(payoutEstimateSpy).toHaveBeenCalledWith(targetAsset, 'ADDR', 1, asset);
      // amount checked separately with toBeCloseTo: prepareFee (0.1) + payoutFee (0.2) hits a binary
      // floating-point artifact (0.30000000000000004) that Util.round(...,16) cannot fully absorb
      // (rounding to 16 decimals is at the edge of double precision), so an exact toEqual on the
      // whole object would be flaky. toBeCloseTo still proves both fees were summed into ~0.3.
      expect(result.asset).toBe(feeAsset);
      expect(result.amount).toBeCloseTo(0.3, 8);
    });

    it('delegates blockchain-fee estimation to the payout strategy resolved for the asset', async () => {
      const asset = createDefaultAsset();
      const feeResult = { asset, amount: 0.05 };
      const estimateBlockchainFeeSpy = jest.fn().mockResolvedValue(feeResult);

      jest
        .spyOn(payoutStrategyRegistry, 'getPayoutStrategy')
        .mockReturnValue({ estimateBlockchainFee: estimateBlockchainFeeSpy } as any);

      const result = await service.estimateBlockchainFee(asset);

      expect(estimateBlockchainFeeSpy).toHaveBeenCalledWith(asset);
      expect(result).toBe(feeResult);
    });
  });

  describe('#getRecentPayoutSentCorrelationIds(...)', () => {
    let service: PayoutService;
    let payoutOrderRepo: PayoutOrderRepository;

    beforeEach(() => {
      payoutOrderRepo = mock<PayoutOrderRepository>();

      service = new PayoutService(
        mock<PayoutLogService>(),
        mock<NotificationService>(),
        payoutOrderRepo,
        mock<PayoutOrderFactory>(),
        mock<PayoutStrategyRegistry>(),
        mock<PrepareStrategyRegistry>(),
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('queries recently sent/completed orders for the context and returns a deduplicated set of correlationIds', async () => {
      const orderA = createCustomPayoutOrder({ id: 150, correlationId: 'CID_A' });
      const orderB = createCustomPayoutOrder({ id: 151, correlationId: 'CID_B' });
      const orderDuplicate = createCustomPayoutOrder({ id: 152, correlationId: 'CID_A' });
      const findBySpy = jest.spyOn(payoutOrderRepo, 'findBy').mockResolvedValue([orderA, orderB, orderDuplicate]);

      const result = await service.getRecentPayoutSentCorrelationIds(PayoutOrderContext.BUY_CRYPTO);

      expect(findBySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          context: PayoutOrderContext.BUY_CRYPTO,
          status: In([PayoutOrderStatus.PAYOUT_PENDING, PayoutOrderStatus.COMPLETE]),
        }),
      );
      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(2);
      expect(result).toEqual(new Set(['CID_A', 'CID_B']));
    });
  });

  describe('#checkPreparationCompletion(...) / #checkPayoutCompletion(...)', () => {
    let service: PayoutService;
    let payoutOrderRepo: PayoutOrderRepository;
    let prepareStrategyRegistry: PrepareStrategyRegistry;
    let payoutStrategyRegistry: PayoutStrategyRegistry;
    let logs: PayoutLogService;

    beforeEach(() => {
      payoutOrderRepo = mock<PayoutOrderRepository>();
      prepareStrategyRegistry = mock<PrepareStrategyRegistry>();
      payoutStrategyRegistry = mock<PayoutStrategyRegistry>();
      logs = mock<PayoutLogService>();

      service = new PayoutService(
        logs,
        mock<NotificationService>(),
        payoutOrderRepo,
        mock<PayoutOrderFactory>(),
        payoutStrategyRegistry,
        prepareStrategyRegistry,
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('checks preparation completion per strategy group and logs the newly confirmed orders', async () => {
      const order = createCustomPayoutOrder({ id: 120, status: PayoutOrderStatus.PREPARATION_CONFIRMED });
      jest.spyOn(payoutOrderRepo, 'findBy').mockResolvedValue([order]);
      const checkSpy = jest.fn().mockResolvedValue(undefined);
      jest
        .spyOn(prepareStrategyRegistry, 'getPrepareStrategy')
        .mockReturnValue({ checkPreparationCompletion: checkSpy } as any);
      const logSpy = jest.spyOn(logs, 'logTransferCompletion');

      await service['checkPreparationCompletion']();

      expect(checkSpy).toHaveBeenCalledWith([order]);
      expect(logSpy).toHaveBeenCalledWith([order]);
    });

    it('isolates a throwing prepare strategy: logs the error and continues without crashing the cron step', async () => {
      const order = createCustomPayoutOrder({ id: 121, status: PayoutOrderStatus.PREPARATION_PENDING });
      jest.spyOn(payoutOrderRepo, 'findBy').mockResolvedValue([order]);
      jest.spyOn(prepareStrategyRegistry, 'getPrepareStrategy').mockReturnValue({
        checkPreparationCompletion: jest.fn().mockRejectedValue(new Error('boom')),
      } as any);
      const errorSpy = jest.spyOn(service['logger'], 'error');

      await expect(service['checkPreparationCompletion']()).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalled();
    });

    it('isolates a throwing prepare-strategy group from a second, healthy strategy group (cross-group isolation)', async () => {
      const assetA = createCustomAsset({ id: 211 });
      const assetB = createCustomAsset({ id: 212 });
      const orderA = createCustomPayoutOrder({ id: 126, status: PayoutOrderStatus.PREPARATION_PENDING, asset: assetA });
      const orderB = createCustomPayoutOrder({ id: 127, status: PayoutOrderStatus.PREPARATION_PENDING, asset: assetB });
      jest.spyOn(payoutOrderRepo, 'findBy').mockResolvedValue([orderA, orderB]);

      const throwingCheck = jest.fn().mockRejectedValue(new Error('boom'));
      const healthyCheck = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(prepareStrategyRegistry, 'getPrepareStrategy').mockImplementation((asset) => {
        if (asset === assetA) return { checkPreparationCompletion: throwingCheck } as any;
        if (asset === assetB) return { checkPreparationCompletion: healthyCheck } as any;
        return undefined;
      });
      const errorSpy = jest.spyOn(service['logger'], 'error');

      await expect(service['checkPreparationCompletion']()).resolves.toBeUndefined();

      expect(throwingCheck).toHaveBeenCalledWith([orderA]);
      // group B's checkPreparationCompletion still runs despite group A's throw: proves catch-isolation across groups
      expect(healthyCheck).toHaveBeenCalledWith([orderB]);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('checks payout completion per strategy group and logs the newly completed orders', async () => {
      const order = createCustomPayoutOrder({ id: 122, status: PayoutOrderStatus.COMPLETE });
      jest.spyOn(payoutOrderRepo, 'findBy').mockResolvedValue([order]);
      const checkSpy = jest.fn().mockResolvedValue(undefined);
      jest
        .spyOn(payoutStrategyRegistry, 'getPayoutStrategy')
        .mockReturnValue({ checkPayoutCompletionData: checkSpy } as any);
      const logSpy = jest.spyOn(logs, 'logPayoutCompletion');

      await service['checkPayoutCompletion']();

      expect(checkSpy).toHaveBeenCalledWith([order]);
      expect(logSpy).toHaveBeenCalledWith([order]);
    });

    it('isolates a throwing payout strategy: logs the error and continues without crashing the cron step', async () => {
      const order = createCustomPayoutOrder({ id: 123, status: PayoutOrderStatus.PAYOUT_PENDING });
      jest.spyOn(payoutOrderRepo, 'findBy').mockResolvedValue([order]);
      jest.spyOn(payoutStrategyRegistry, 'getPayoutStrategy').mockReturnValue({
        checkPayoutCompletionData: jest.fn().mockRejectedValue(new Error('boom')),
      } as any);
      const errorSpy = jest.spyOn(service['logger'], 'error');

      await expect(service['checkPayoutCompletion']()).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalled();
    });

    it('isolates a throwing payout-strategy group from a second, healthy strategy group (cross-group isolation)', async () => {
      const assetA = createCustomAsset({ id: 221 });
      const assetB = createCustomAsset({ id: 222 });
      const orderA = createCustomPayoutOrder({ id: 128, status: PayoutOrderStatus.PAYOUT_PENDING, asset: assetA });
      const orderB = createCustomPayoutOrder({ id: 129, status: PayoutOrderStatus.PAYOUT_PENDING, asset: assetB });
      jest.spyOn(payoutOrderRepo, 'findBy').mockResolvedValue([orderA, orderB]);

      const throwingCheck = jest.fn().mockRejectedValue(new Error('boom'));
      const healthyCheck = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(payoutStrategyRegistry, 'getPayoutStrategy').mockImplementation((asset) => {
        if (asset === assetA) return { checkPayoutCompletionData: throwingCheck } as any;
        if (asset === assetB) return { checkPayoutCompletionData: healthyCheck } as any;
        return undefined;
      });
      const errorSpy = jest.spyOn(service['logger'], 'error');

      await expect(service['checkPayoutCompletion']()).resolves.toBeUndefined();

      expect(throwingCheck).toHaveBeenCalledWith([orderA]);
      // group B's checkPayoutCompletionData still runs despite group A's throw: proves catch-isolation across groups
      expect(healthyCheck).toHaveBeenCalledWith([orderB]);
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('#prepareNewOrders(...)', () => {
    let service: PayoutService;
    let payoutOrderRepo: PayoutOrderRepository;
    let prepareStrategyRegistry: PrepareStrategyRegistry;
    let logs: PayoutLogService;

    beforeEach(() => {
      payoutOrderRepo = mock<PayoutOrderRepository>();
      prepareStrategyRegistry = mock<PrepareStrategyRegistry>();
      logs = mock<PayoutLogService>();

      service = new PayoutService(
        logs,
        mock<NotificationService>(),
        payoutOrderRepo,
        mock<PayoutOrderFactory>(),
        mock<PayoutStrategyRegistry>(),
        prepareStrategyRegistry,
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('skips preparing new orders while the latest order is within the debounce window', async () => {
      jest.spyOn(payoutOrderRepo, 'findOne').mockResolvedValue({ created: new Date() } as PayoutOrder);
      const findBySpy = jest.spyOn(payoutOrderRepo, 'findBy');

      await service['prepareNewOrders']();

      expect(findBySpy).not.toHaveBeenCalled();
    });

    it('treats an empty order table (no latest order date) as stable and proceeds to prepare', async () => {
      jest.spyOn(payoutOrderRepo, 'findOne').mockResolvedValue(null);
      const order = createCustomPayoutOrder({ id: 130, status: PayoutOrderStatus.PREPARATION_PENDING });
      const findBySpy = jest.spyOn(payoutOrderRepo, 'findBy').mockResolvedValue([order]);
      const prepareSpy = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(prepareStrategyRegistry, 'getPrepareStrategy').mockReturnValue({ preparePayout: prepareSpy } as any);
      const logSpy = jest.spyOn(logs, 'logNewPayoutOrders');

      await service['prepareNewOrders']();

      expect(findBySpy).toHaveBeenCalledWith({ status: PayoutOrderStatus.CREATED });
      expect(prepareSpy).toHaveBeenCalledWith([order]);
      expect(logSpy).toHaveBeenCalledWith([order]);
    });

    it('once the debounce time has elapsed, prepares CREATED orders per strategy group', async () => {
      const oldDate = new Date(Date.now() - 60_000);
      jest.spyOn(payoutOrderRepo, 'findOne').mockResolvedValue({ created: oldDate } as PayoutOrder);
      const order = createCustomPayoutOrder({ id: 131, status: PayoutOrderStatus.CREATED });
      const findBySpy = jest.spyOn(payoutOrderRepo, 'findBy').mockResolvedValue([order]);
      const prepareSpy = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(prepareStrategyRegistry, 'getPrepareStrategy').mockReturnValue({ preparePayout: prepareSpy } as any);

      await service['prepareNewOrders']();

      expect(findBySpy).toHaveBeenCalledWith({ status: PayoutOrderStatus.CREATED });
      expect(prepareSpy).toHaveBeenCalledWith([order]);
    });

    it('isolates a throwing prepare strategy during new-order preparation: logs the error and continues', async () => {
      jest.spyOn(payoutOrderRepo, 'findOne').mockResolvedValue(null);
      const order = createCustomPayoutOrder({ id: 132, status: PayoutOrderStatus.CREATED });
      jest.spyOn(payoutOrderRepo, 'findBy').mockResolvedValue([order]);
      jest.spyOn(prepareStrategyRegistry, 'getPrepareStrategy').mockReturnValue({
        preparePayout: jest.fn().mockRejectedValue(new Error('boom')),
      } as any);
      const errorSpy = jest.spyOn(service['logger'], 'error');

      await expect(service['prepareNewOrders']()).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalled();
    });

    it('isolates a throwing prepare-strategy group from a second, healthy strategy group during new-order preparation (cross-group isolation)', async () => {
      jest.spyOn(payoutOrderRepo, 'findOne').mockResolvedValue(null);
      const assetA = createCustomAsset({ id: 231 });
      const assetB = createCustomAsset({ id: 232 });
      const orderA = createCustomPayoutOrder({ id: 133, status: PayoutOrderStatus.CREATED, asset: assetA });
      const orderB = createCustomPayoutOrder({ id: 134, status: PayoutOrderStatus.CREATED, asset: assetB });
      jest.spyOn(payoutOrderRepo, 'findBy').mockResolvedValue([orderA, orderB]);

      const throwingPrepare = jest.fn().mockRejectedValue(new Error('boom'));
      const healthyPrepare = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(prepareStrategyRegistry, 'getPrepareStrategy').mockImplementation((asset) => {
        if (asset === assetA) return { preparePayout: throwingPrepare } as any;
        if (asset === assetB) return { preparePayout: healthyPrepare } as any;
        return undefined;
      });
      const errorSpy = jest.spyOn(service['logger'], 'error');

      await expect(service['prepareNewOrders']()).resolves.toBeUndefined();

      expect(throwingPrepare).toHaveBeenCalledWith([orderA]);
      // group B's preparePayout still runs despite group A's throw: proves catch-isolation across groups
      expect(healthyPrepare).toHaveBeenCalledWith([orderB]);
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('#groupByStrategies(...)', () => {
    let service: PayoutService;

    beforeEach(() => {
      service = new PayoutService(
        mock<PayoutLogService>(),
        mock<NotificationService>(),
        mock<PayoutOrderRepository>(),
        mock<PayoutOrderFactory>(),
        mock<PayoutStrategyRegistry>(),
        mock<PrepareStrategyRegistry>(),
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('accumulates multiple orders resolving to the same strategy into a single group (existing-group branch)', () => {
      const sharedStrategy = { name: 'shared-strategy' };
      const orderA = createCustomPayoutOrder({ id: 140 });
      const orderB = createCustomPayoutOrder({ id: 141 });
      const getter = jest.fn().mockReturnValue(sharedStrategy);

      const groups = service['groupByStrategies']([orderA, orderB], getter);

      expect(groups.size).toBe(1);
      expect(groups.get(sharedStrategy)).toEqual([orderA, orderB]);
    });

    it('skips an order without a resolvable strategy and logs a warning', () => {
      const orphanOrder = createCustomPayoutOrder({ id: 142 });
      const getter = jest.fn().mockReturnValue(undefined);
      const warnSpy = jest.spyOn(service['logger'], 'warn');

      const groups = service['groupByStrategies']([orphanOrder], getter);

      expect(groups.size).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`for payout order ID ${orphanOrder.id}`));
    });
  });

  describe('#createMailRequest(...)', () => {
    let service: PayoutService;

    beforeEach(() => {
      service = new PayoutService(
        mock<PayoutLogService>(),
        mock<NotificationService>(),
        mock<PayoutOrderRepository>(),
        mock<PayoutOrderFactory>(),
        mock<PayoutStrategyRegistry>(),
        mock<PrepareStrategyRegistry>(),
      );
    });

    it('defaults orders to an empty list, yielding an empty correlationId', () => {
      const request = service['createMailRequest']('Payout failed');

      expect(request.correlationId).toBe('');
    });
  });
});
