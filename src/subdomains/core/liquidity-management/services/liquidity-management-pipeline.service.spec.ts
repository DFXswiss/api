import { createMock } from '@golevelup/ts-jest';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { LiquidityManagementOrder } from '../entities/liquidity-management-order.entity';
import { LiquidityManagementPipeline } from '../entities/liquidity-management-pipeline.entity';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';
import {
  LiquidityManagementOrderStatus,
  LiquidityManagementPipelineStatus,
  LiquidityManagementRuleStatus,
  LiquidityOptimizationType,
  UncertainOrderResolution,
} from '../enums';
import { OrderOutcomeUnknownException } from '../exceptions/order-outcome-unknown.exception';
import { LiquidityActionIntegrationFactory } from '../factories/liquidity-action-integration.factory';
import { LiquidityManagementOrderRepository } from '../repositories/liquidity-management-order.repository';
import { LiquidityManagementPipelineRepository } from '../repositories/liquidity-management-pipeline.repository';
import { LiquidityManagementRuleRepository } from '../repositories/liquidity-management-rule.repository';
import { LiquidityManagementPipelineService } from './liquidity-management-pipeline.service';
import { LiquidityManagementService } from './liquidity-management.service';

describe('LiquidityManagementPipelineService', () => {
  let service: LiquidityManagementPipelineService;
  let ruleRepo: LiquidityManagementRuleRepository;
  let orderRepo: LiquidityManagementOrderRepository;
  let pipelineRepo: LiquidityManagementPipelineRepository;
  let actionIntegrationFactory: LiquidityActionIntegrationFactory;
  let notificationService: NotificationService;
  let liquidityManagementService: LiquidityManagementService;

  beforeEach(() => {
    ruleRepo = createMock<LiquidityManagementRuleRepository>();
    orderRepo = createMock<LiquidityManagementOrderRepository>();
    pipelineRepo = createMock<LiquidityManagementPipelineRepository>();
    actionIntegrationFactory = createMock<LiquidityActionIntegrationFactory>();
    notificationService = createMock<NotificationService>();
    liquidityManagementService = createMock<LiquidityManagementService>();

    service = new LiquidityManagementPipelineService(
      ruleRepo,
      orderRepo,
      pipelineRepo,
      actionIntegrationFactory,
      notificationService,
      liquidityManagementService,
    );
  });

  describe('startNewOrders — unknown outcomes', () => {
    function createdOrder(id = 7): LiquidityManagementOrder {
      return Object.assign(new LiquidityManagementOrder(), {
        id,
        status: LiquidityManagementOrderStatus.CREATED,
        action: { id: 233, system: 'Scrypt', command: 'sell' },
      });
    }

    it('quarantines an order as UNCERTAIN instead of failing it when the outcome is unknown', async () => {
      const order = createdOrder();
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      jest.spyOn(actionIntegrationFactory, 'getIntegration').mockReturnValue({
        supportedCommands: ['sell'],
        executeOrder: jest.fn().mockRejectedValue(new OrderOutcomeUnknownException('Scrypt did not answer')),
        checkCompletion: jest.fn(),
        validateParams: jest.fn(),
      });

      await service['startNewOrders']();

      // FAILED would pause the rule, and the rule auto-reactivates — i.e. it would repeat a request that
      // may already have executed. That is the exact path that mis-booked two live withdrawals.
      expect(order.status).toBe(LiquidityManagementOrderStatus.UNCERTAIN);
      expect(order.status).not.toBe(LiquidityManagementOrderStatus.FAILED);
      expect(notificationService.sendMail).toHaveBeenCalled();
    });

    it('fails — not quarantines — an unclassified error when no reference was ever reserved', async () => {
      const order = createdOrder();
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      jest.spyOn(actionIntegrationFactory, 'getIntegration').mockReturnValue({
        supportedCommands: ['sell'],
        // no reserveCorrelationId, so nothing can have been transmitted
        executeOrder: jest.fn().mockRejectedValue(new Error('no integration configured')),
        checkCompletion: jest.fn(),
        validateParams: jest.fn(),
      });

      const anyChanged = await service['startNewOrders']();

      // quarantining a provably-never-sent request would strand config errors in a human-only state
      expect(order.status).toBe(LiquidityManagementOrderStatus.FAILED);
      // and it must still leave CREATED, or the caller's `while (hasChanges)` loop cannot terminate
      expect(anyChanged).toBe(true);
    });

    it('quarantines an unclassified error once a reference was reserved', async () => {
      const order = createdOrder();
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      jest.spyOn(actionIntegrationFactory, 'getIntegration').mockReturnValue({
        supportedCommands: ['sell'],
        reserveCorrelationId: () => 'dfx-lm-7',
        executeOrder: jest.fn().mockRejectedValue(new Error('socket exploded mid-send')),
        checkCompletion: jest.fn(),
        validateParams: jest.fn(),
      });

      const anyChanged = await service['startNewOrders']();

      expect(order.status).toBe(LiquidityManagementOrderStatus.UNCERTAIN);
      expect(anyChanged).toBe(true);
    });

    it('never re-sends a CREATED order that already carries a reserved reference', async () => {
      // that combination means a previous pass reached the send boundary and died before recording the
      // result — re-sending is the one thing that could duplicate a live request
      const order = createdOrder();
      order.correlationId = 'dfx-lm-7';
      const executeOrder = jest.fn();
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      jest.spyOn(actionIntegrationFactory, 'getIntegration').mockReturnValue({
        supportedCommands: ['sell'],
        reserveCorrelationId: () => 'dfx-lm-7',
        executeOrder,
        checkCompletion: jest.fn(),
        validateParams: jest.fn(),
      });

      await service['startNewOrders']();

      expect(executeOrder).not.toHaveBeenCalled();
      expect(order.status).toBe(LiquidityManagementOrderStatus.UNCERTAIN);
      expect(notificationService.sendMail).toHaveBeenCalled();
    });

    it('persists the reserved correlation id BEFORE the request is sent', async () => {
      const order = createdOrder(4711);
      const saveOrder: string[] = [];
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      jest.spyOn(orderRepo, 'save').mockImplementation(async (o: LiquidityManagementOrder) => {
        saveOrder.push(`save:${o.status}:${o.correlationId}`);
        return o;
      });
      jest.spyOn(actionIntegrationFactory, 'getIntegration').mockReturnValue({
        supportedCommands: ['sell'],
        reserveCorrelationId: () => 'dfx-lm-4711',
        executeOrder: jest.fn().mockImplementation(async () => {
          saveOrder.push('send');
          return 'dfx-lm-4711';
        }),
        checkCompletion: jest.fn(),
        validateParams: jest.fn(),
      });

      await service['startNewOrders']();

      // the reference must be durable before the request leaves — otherwise a timeout loses it for good
      expect(saveOrder).toEqual(['save:Created:dfx-lm-4711', 'send', 'save:InProgress:dfx-lm-4711']);
    });
  });

  describe('resolveUncertainOrders', () => {
    /** Fixed and weeks old: the resolve cooldown derives its interval from the order's age, so a moving
     * `created` would make these tests depend on when they run. */
    const ORDER_CREATED = new Date('2026-07-01T00:00:00Z');

    function uncertainOrder(overrides: Partial<LiquidityManagementOrder> = {}): LiquidityManagementOrder {
      return Object.assign(new LiquidityManagementOrder(), {
        id: 9,
        status: LiquidityManagementOrderStatus.UNCERTAIN,
        correlationId: 'dfx-lm-9',
        errorMessage: 'Scrypt did not answer',
        created: ORDER_CREATED,
        action: { id: 233, system: 'Scrypt', command: 'sell' },
        ...overrides,
      });
    }

    /** An order somebody has released as never sent — accepted, but not yet in effect. */
    const RELEASED_AT = new Date(Date.now() - 5 * 60 * 1000);

    function releasePendingOrder(releasedAt = RELEASED_AT): LiquidityManagementOrder {
      return uncertainOrder({
        errorMessage: 'Scrypt did not answer (released by account 42: venue checked — ticket OPS-42)',
        notSentRecheckDue: releasedAt,
      });
    }

    function stubIntegration(resolution: UncertainOrderResolution): void {
      jest.spyOn(actionIntegrationFactory, 'getIntegration').mockReturnValue({
        supportedCommands: ['sell'],
        executeOrder: jest.fn(),
        checkCompletion: jest.fn(),
        validateParams: jest.fn(),
        resolveUncertainOrder: jest.fn().mockResolvedValue(resolution),
      });
    }

    it('only ever asks about quarantined orders', async () => {
      const findBy = jest.spyOn(orderRepo, 'findBy').mockResolvedValue([]);

      await service['resolveUncertainOrders']();

      expect(findBy).toHaveBeenCalledWith({ status: LiquidityManagementOrderStatus.UNCERTAIN });
    });

    it.each([
      [UncertainOrderResolution.SENT, LiquidityManagementOrderStatus.IN_PROGRESS],
      [UncertainOrderResolution.NOT_SENT, LiquidityManagementOrderStatus.FAILED],
      [UncertainOrderResolution.UNRESOLVED, LiquidityManagementOrderStatus.UNCERTAIN],
      [UncertainOrderResolution.UNAVAILABLE, LiquidityManagementOrderStatus.UNCERTAIN],
    ])('moves an unreleased order on %s -> %s', async (resolution, expectedStatus) => {
      const order = uncertainOrder();
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      stubIntegration(resolution);

      await service['resolveUncertainOrders']();

      expect(order.status).toBe(expectedStatus);
    });

    it('keeps a released order quarantined until the venue has actually answered', async () => {
      // the release is a judgement, and while it is unconfirmed the order must not become terminal —
      // a terminal order lets its rule plan again against funds that may well be committed
      const order = releasePendingOrder();
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      stubIntegration(UncertainOrderResolution.UNAVAILABLE);

      await service['resolveUncertainOrders']();

      expect(order.status).toBe(LiquidityManagementOrderStatus.UNCERTAIN);
      expect(orderRepo.update).not.toHaveBeenCalled();
    });

    it('puts a release into effect once the venue confirms it has no record either', async () => {
      const order = releasePendingOrder();
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      const update = jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      stubIntegration(UncertainOrderResolution.UNRESOLVED);

      await expect(service['resolveUncertainOrders']()).resolves.toBe(true);

      // the write is what counts, not the in-memory entity — and it is guarded on the exact release examined
      expect(update).toHaveBeenCalledWith(
        {
          id: 9,
          status: LiquidityManagementOrderStatus.UNCERTAIN,
          notSentRecheckDue: RELEASED_AT,
        },
        expect.objectContaining({ status: LiquidityManagementOrderStatus.FAILED, notSentRecheckDue: null }),
      );
      // the operator and their reference survive, and the release is dated
      expect(update.mock.calls[0][1].errorMessage).toContain('OPS-42');
      expect(update.mock.calls[0][1].errorMessage).toMatch(/released \d{4}-\d{2}-\d{2}T/);
    });

    it('cannot end an order on a release written after the one it examined', async () => {
      // a newer release has a confirmation of its own outstanding; ending the order on the older reading
      // would skip it, and ending an order is the one step nothing here can take back
      const order = releasePendingOrder();
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      const update = jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });
      stubIntegration(UncertainOrderResolution.UNRESOLVED);

      await expect(service['resolveUncertainOrders']()).resolves.toBe(false);

      expect(update.mock.calls[0][0]).toMatchObject({ notSentRecheckDue: RELEASED_AT });
    });

    it('does not release an unreleased order on the same inconclusive answer', async () => {
      // absence is not proof; without somebody having checked independently there is only one negative
      const order = uncertainOrder();
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      stubIntegration(UncertainOrderResolution.UNRESOLVED);

      await service['resolveUncertainOrders']();

      expect(order.status).toBe(LiquidityManagementOrderStatus.UNCERTAIN);
    });

    it('lets a verified release through once the venue has been unreachable for an hour', async () => {
      // a check nobody can perform must not hold an order somebody has verified by hand out of reach for
      // good — nothing is concluded from the silence, the person who released it concluded it
      const order = releasePendingOrder(new Date(Date.now() - 120 * 60 * 1000));
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      stubIntegration(UncertainOrderResolution.UNAVAILABLE);

      await expect(service['resolveUncertainOrders']()).resolves.toBe(true);

      expect(order.status).toBe(LiquidityManagementOrderStatus.FAILED);
      expect(order.errorMessage).toContain('could not be reached');
    });

    it('overrules a pending release the moment the venue confirms the order', async () => {
      const order = releasePendingOrder();
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      stubIntegration(UncertainOrderResolution.SENT);

      await service['resolveUncertainOrders']();

      expect(order.status).toBe(LiquidityManagementOrderStatus.IN_PROGRESS);
      expect(order.notSentRecheckDue).toBeNull();
    });

    it('puts a release into effect when no integration can ever look the order up', async () => {
      // the documented exception: waiting on an answer that can never come would quarantine it for good
      const order = releasePendingOrder();
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      const update = jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      jest.spyOn(actionIntegrationFactory, 'getIntegration').mockReturnValue(null);

      // and the pass reports the change, so the caller's loop knows something moved
      await expect(service['resolveUncertainOrders']()).resolves.toBe(true);

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 9, notSentRecheckDue: RELEASED_AT }),
        expect.objectContaining({ status: LiquidityManagementOrderStatus.FAILED }),
      );
    });

    it('leaves an unreleased order alone when its adapter is gone', async () => {
      const order = uncertainOrder();
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      jest.spyOn(actionIntegrationFactory, 'getIntegration').mockReturnValue(null);

      await service['resolveUncertainOrders']();

      expect(order.status).toBe(LiquidityManagementOrderStatus.UNCERTAIN);
      expect(orderRepo.update).not.toHaveBeenCalled();
    });

    it('puts a confirmed order back into quarantine when the release does not land', async () => {
      // an alert alone is read at human speed while the rule reactivates in minutes
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([uncertainOrder()]);
      jest
        .spyOn(orderRepo, 'findOneBy')
        .mockResolvedValue(uncertainOrder({ status: LiquidityManagementOrderStatus.FAILED }));
      const update = jest
        .spyOn(orderRepo, 'update')
        .mockResolvedValueOnce({ affected: 1, raw: [], generatedMaps: [] })
        .mockResolvedValueOnce({ affected: 0, raw: [], generatedMaps: [] })
        .mockResolvedValueOnce({ affected: 1, raw: [], generatedMaps: [] });
      stubIntegration(UncertainOrderResolution.SENT);

      await service['resolveUncertainOrders']();

      expect(update.mock.calls[2][1]).toMatchObject({ status: LiquidityManagementOrderStatus.UNCERTAIN });
      expect(notificationService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: 'lm-observation-unapplied-9' }),
      );
    });

    it('does the same when the release throws instead of matching nothing', async () => {
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([uncertainOrder()]);
      jest
        .spyOn(orderRepo, 'findOneBy')
        .mockResolvedValue(uncertainOrder({ status: LiquidityManagementOrderStatus.FAILED }));
      const update = jest
        .spyOn(orderRepo, 'update')
        .mockResolvedValueOnce({ affected: 1, raw: [], generatedMaps: [] })
        .mockRejectedValueOnce(new Error('connection lost'))
        .mockResolvedValueOnce({ affected: 1, raw: [], generatedMaps: [] });
      stubIntegration(UncertainOrderResolution.SENT);

      await service['resolveUncertainOrders']();

      expect(update.mock.calls[2][1]).toMatchObject({ status: LiquidityManagementOrderStatus.UNCERTAIN });
      expect(notificationService.sendMail).toHaveBeenCalled();
    });

    it('keeps retrying a confirmed observation whose repair write failed, until it lands', async () => {
      // one failed statement must not be the end of an observation: the order would stay terminal while the
      // venue works it, and nothing selects a terminal row again
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([uncertainOrder()]);
      jest
        .spyOn(orderRepo, 'findOneBy')
        .mockResolvedValue(uncertainOrder({ status: LiquidityManagementOrderStatus.FAILED }));
      const update = jest
        .spyOn(orderRepo, 'update')
        .mockResolvedValueOnce({ affected: 1, raw: [], generatedMaps: [] })
        .mockResolvedValueOnce({ affected: 0, raw: [], generatedMaps: [] }) // the release misses
        .mockRejectedValueOnce(new Error('deadlock detected')) // and the repair fails
        .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      stubIntegration(UncertainOrderResolution.SENT);

      await service['resolveUncertainOrders']();
      expect(service['unappliedObservations'].size).toBe(1);

      // the next pass repeats the write before it asks the venue anything
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([]);
      await service['resolveUncertainOrders']();

      expect(update).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ status: LiquidityManagementOrderStatus.UNCERTAIN }),
      );
      expect(service['unappliedObservations'].size).toBe(0);
    });

    it('stops retrying once another path has put the order somewhere safe', async () => {
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([uncertainOrder()]);
      jest
        .spyOn(orderRepo, 'findOneBy')
        .mockResolvedValueOnce(uncertainOrder({ status: LiquidityManagementOrderStatus.FAILED }))
        .mockResolvedValue(uncertainOrder({ status: LiquidityManagementOrderStatus.IN_PROGRESS }));
      jest
        .spyOn(orderRepo, 'update')
        .mockResolvedValueOnce({ affected: 1, raw: [], generatedMaps: [] })
        .mockResolvedValueOnce({ affected: 0, raw: [], generatedMaps: [] })
        .mockRejectedValueOnce(new Error('deadlock detected'));
      stubIntegration(UncertainOrderResolution.SENT);

      await service['resolveUncertainOrders']();
      expect(service['unappliedObservations'].size).toBe(1);

      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([]);
      await service['resolveUncertainOrders']();

      expect(service['unappliedObservations'].size).toBe(0);
    });

    it('makes a confirmed order safe with the very first write, whatever state it is in', async () => {
      // until this lands, the only thing keeping a confirmed order from being treated as finished business
      // is this process staying alive — so it comes before the substantial write, and covers an order a
      // concurrent release has already ended
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([releasePendingOrder()]);
      const update = jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      stubIntegration(UncertainOrderResolution.SENT);

      await service['resolveUncertainOrders']();

      const [where, payload] = update.mock.calls[0];
      expect(payload).toEqual({
        status: LiquidityManagementOrderStatus.UNCERTAIN,
        notSentRecheckDue: null,
      });
      expect(where).toMatchObject({ id: 9 });
      // an order already ended by a release is repaired by this same statement
      const status = (where as unknown as { status: { _value: LiquidityManagementOrderStatus[] } }).status;
      expect(status._value).toEqual(expect.arrayContaining([LiquidityManagementOrderStatus.FAILED]));
    });

    it('reports a confirmed order whose state it cannot even read', async () => {
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([uncertainOrder()]);
      jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });
      jest.spyOn(orderRepo, 'findOneBy').mockRejectedValue(new Error('connection lost'));
      stubIntegration(UncertainOrderResolution.SENT);

      await service['resolveUncertainOrders']();

      expect(notificationService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: 'lm-observation-unapplied-9' }),
      );
    });

    it('stays quiet when something else had already released the order correctly', async () => {
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([uncertainOrder()]);
      jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });
      jest
        .spyOn(orderRepo, 'findOneBy')
        .mockResolvedValue(uncertainOrder({ status: LiquidityManagementOrderStatus.IN_PROGRESS }));
      stubIntegration(UncertainOrderResolution.SENT);

      await service['resolveUncertainOrders']();

      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('keeps the order quarantined when the lookup itself throws', async () => {
      const order = uncertainOrder();
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      jest.spyOn(actionIntegrationFactory, 'getIntegration').mockReturnValue({
        supportedCommands: ['sell'],
        executeOrder: jest.fn(),
        checkCompletion: jest.fn(),
        validateParams: jest.fn(),
        resolveUncertainOrder: jest.fn().mockRejectedValue(new Error('venue unreachable')),
      });

      await service['resolveUncertainOrders']();

      expect(order.status).toBe(LiquidityManagementOrderStatus.UNCERTAIN);
    });

    describe('venue-lookup cooldown', () => {
      // The cooldown is a pure function of Date.now(), so these tests drive the clock instead of waiting.
      // Scoped here rather than suite-wide: nothing else in this file cares about time.
      beforeEach(() => jest.useFakeTimers());
      afterEach(() => jest.useRealTimers());

      /** Like `stubIntegration`, but hands the lookup mock back so a test can count venue asks. UNAVAILABLE
       * keeps the order quarantined without touching any other state, so every pass sees the same picture
       * and only the cooldown decides whether the venue is asked. */
      function stubResolver(): jest.Mock {
        const resolveUncertainOrder = jest.fn().mockResolvedValue(UncertainOrderResolution.UNAVAILABLE);
        jest.spyOn(actionIntegrationFactory, 'getIntegration').mockReturnValue({
          supportedCommands: ['sell'],
          executeOrder: jest.fn(),
          checkCompletion: jest.fn(),
          validateParams: jest.fn(),
          resolveUncertainOrder,
        });
        return resolveUncertainOrder;
      }

      it('asks the venue immediately on the first pass for a fresh quarantined order', async () => {
        const resolveUncertainOrder = stubResolver();
        jest.spyOn(orderRepo, 'findBy').mockResolvedValue([uncertainOrder({ created: new Date() })]);

        await service['resolveUncertainOrders']();

        expect(resolveUncertainOrder).toHaveBeenCalledTimes(1);
      });

      it('does not ask again while the cooldown is running', async () => {
        const resolveUncertainOrder = stubResolver();
        jest.spyOn(orderRepo, 'findBy').mockResolvedValue([uncertainOrder({ created: new Date() })]);

        await service['resolveUncertainOrders']();
        // the next cron tick, well inside the one-minute floor a fresh order gets
        jest.advanceTimersByTime(10_000);
        await service['resolveUncertainOrders']();

        expect(resolveUncertainOrder).toHaveBeenCalledTimes(1);
      });

      it('asks again once the cooldown has elapsed', async () => {
        const resolveUncertainOrder = stubResolver();
        jest.spyOn(orderRepo, 'findBy').mockResolvedValue([uncertainOrder({ created: new Date() })]);

        await service['resolveUncertainOrders']();
        jest.advanceTimersByTime(61_000);
        await service['resolveUncertainOrders']();

        expect(resolveUncertainOrder).toHaveBeenCalledTimes(2);
      });

      it('measures the cooldown from the end of the lookup, not its start', async () => {
        // a lookup can be slow — a stamp taken at its start would already be half-expired by the time it
        // finishes, letting the next pass re-enter immediately
        const resolveUncertainOrder = stubResolver();
        resolveUncertainOrder.mockImplementation(async () => {
          jest.advanceTimersByTime(120_000); // a lookup that outlives the one-minute floor
          return UncertainOrderResolution.UNAVAILABLE;
        });
        jest.spyOn(orderRepo, 'findBy').mockResolvedValue([uncertainOrder({ created: new Date() })]);

        await service['resolveUncertainOrders']();
        await service['resolveUncertainOrders']();

        expect(resolveUncertainOrder).toHaveBeenCalledTimes(1);
      });

      it('starts the cooldown even when the venue lookup throws', async () => {
        // a dead connection is exactly the regime the cooldown exists for — stamping only successful
        // lookups would re-ask a venue that cannot answer on every pass, at full fetch cost each time
        const resolveUncertainOrder = stubResolver();
        resolveUncertainOrder.mockRejectedValue(new Error('Connection closed'));
        jest.spyOn(orderRepo, 'findBy').mockResolvedValue([uncertainOrder({ created: new Date() })]);

        await service['resolveUncertainOrders']();
        await service['resolveUncertainOrders']();

        expect(resolveUncertainOrder).toHaveBeenCalledTimes(1);
      });

      it('resolves an order with a pending release on every pass', async () => {
        // a manual release must complete on the next tick, and its own venue-wait runs on its own clock —
        // the cooldown has no say here
        const resolveUncertainOrder = stubResolver();
        jest.spyOn(orderRepo, 'findBy').mockResolvedValue([releasePendingOrder()]);

        await service['resolveUncertainOrders']();
        await service['resolveUncertainOrders']();

        expect(resolveUncertainOrder).toHaveBeenCalledTimes(2);
      });

      it('starts a fresh cooldown when an order re-enters quarantine after leaving it', async () => {
        // the stamp's lifetime is one quarantine episode: a venue verdict releases the order, and when the
        // completion check quarantines it anew moments later, the NEW episode's first lookup must not
        // inherit the previous episode's wait
        const resolveUncertainOrder = stubResolver();
        resolveUncertainOrder.mockResolvedValueOnce(UncertainOrderResolution.NOT_SENT);
        jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
        const findBy = jest.spyOn(orderRepo, 'findBy');

        findBy.mockResolvedValueOnce([uncertainOrder({ created: new Date() })]);
        await service['resolveUncertainOrders']();

        findBy.mockResolvedValueOnce([uncertainOrder({ created: new Date() })]);
        await service['resolveUncertainOrders']();

        expect(resolveUncertainOrder).toHaveBeenCalledTimes(2);
      });

      it('prunes the cooldown entry once an order has left quarantine', async () => {
        stubResolver();
        const findBy = jest.spyOn(orderRepo, 'findBy');

        findBy.mockResolvedValueOnce([uncertainOrder({ created: new Date() })]);
        await service['resolveUncertainOrders']();
        expect(service['uncertainResolveAttempts'].size).toBe(1);

        // resolved elsewhere: the quarantine set no longer holds the order, so its entry must not linger
        findBy.mockResolvedValueOnce([]);
        await service['resolveUncertainOrders']();
        expect(service['uncertainResolveAttempts'].size).toBe(0);
      });

      it('scales the cooldown interval with the order age, at the rate the formula states', async () => {
        // Pins `ageMs / 10` from both sides. The wait for a 100-minute-old order is only satisfied once
        // elapsed >= (100 min + elapsed) / 10, i.e. at 11 min 6.7 s — so 11 minutes is still inside it and
        // 11 min 20 s is past it. A one-sided assertion would let the rate drift unnoticed: with `ageMs / 5`
        // the order simply stays in cooldown and a lower-bound-only test keeps passing.
        const resolveUncertainOrder = stubResolver();
        const order = uncertainOrder({ created: new Date(Date.now() - 100 * 60_000) });
        jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);

        await service['resolveUncertainOrders']();

        jest.advanceTimersByTime(11 * 60_000);
        await service['resolveUncertainOrders']();
        expect(resolveUncertainOrder).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(20_000);
        await service['resolveUncertainOrders']();
        expect(resolveUncertainOrder).toHaveBeenCalledTimes(2);
      });

      it('caps the cooldown interval at thirty minutes no matter how old the order is', async () => {
        // Pins the cap to the millisecond. An 8-hour-old order's uncapped wait would be 48 minutes at the
        // first pass and 51 by the time of the boundary check — either way far past the cap, so a lookup at
        // exactly 30 minutes can only come from it. Requiring no lookup a millisecond earlier leaves the cap
        // no other whole-millisecond value to take, and landing on the boundary pins `<` against `<=`.
        const resolveUncertainOrder = stubResolver();
        const order = uncertainOrder({ created: new Date(Date.now() - 8 * 60 * 60_000) });
        jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);

        await service['resolveUncertainOrders']();

        jest.advanceTimersByTime(30 * 60_000 - 1);
        await service['resolveUncertainOrders']();
        expect(resolveUncertainOrder).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(1);
        await service['resolveUncertainOrders']();
        expect(resolveUncertainOrder).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('resolveUncertainOrderManually', () => {
    const VERIFIED_DTO = { noExecutionVerified: true, verificationReference: 'venue console, ticket OPS-42' };

    it('refuses an unverified claim, even if the edge validation were bypassed', async () => {
      await expect(
        service.resolveUncertainOrderManually(9, { noExecutionVerified: false, verificationReference: 'x' }, 42),
      ).rejects.toThrow(/noExecutionVerified must be true/);
    });

    it('refuses a whitespace-only verification reference', async () => {
      await expect(
        service.resolveUncertainOrderManually(9, { noExecutionVerified: true, verificationReference: '   ' }, 42),
      ).rejects.toThrow(/must name where the venue was checked/);
    });

    it('refuses to release an order the venue confirms is live, whoever would win the write', async () => {
      // the race the compare-and-set alone cannot decide: writing first is not the same as being right
      const order = Object.assign(new LiquidityManagementOrder(), {
        id: 9,
        status: LiquidityManagementOrderStatus.UNCERTAIN,
        errorMessage: 'unknown',
        action: { id: 233, system: 'Scrypt', command: 'sell' },
      });
      jest.spyOn(orderRepo, 'findOneBy').mockResolvedValue(order);
      jest.spyOn(actionIntegrationFactory, 'getIntegration').mockReturnValue({
        supportedCommands: ['sell'],
        executeOrder: jest.fn(),
        checkCompletion: jest.fn(),
        validateParams: jest.fn(),
        resolveUncertainOrder: jest.fn().mockResolvedValue(UncertainOrderResolution.SENT),
      });

      await expect(service.resolveUncertainOrderManually(9, VERIFIED_DTO, 42)).rejects.toThrow(
        /the venue confirms the request exists/,
      );
      // and the observation is PERSISTED, not just refused — otherwise a later attempt made while the venue
      // is unreachable could still release the order and undo what was seen here
      expect(order.status).toBe(LiquidityManagementOrderStatus.IN_PROGRESS);
      expect(orderRepo.update).toHaveBeenCalled();
    });

    it('holds a confirmed order and reports it when the manual refusal cannot be written either', async () => {
      // the manual path faces the same race as reconciliation, so it must end the same way: the order stays
      // blocking and a person is told, rather than the observation being discarded with the exception
      const order = Object.assign(new LiquidityManagementOrder(), {
        id: 9,
        status: LiquidityManagementOrderStatus.UNCERTAIN,
        errorMessage: 'unknown',
        action: { id: 233, system: 'Scrypt', command: 'sell' },
      });
      const raced = Object.assign(new LiquidityManagementOrder(), {
        id: 9,
        status: LiquidityManagementOrderStatus.FAILED,
        errorMessage: 'unknown (released by account 7: venue checked — ticket OPS-99)',
        action: { id: 233, system: 'Scrypt', command: 'sell' },
      });
      jest.spyOn(orderRepo, 'findOneBy').mockResolvedValueOnce(order).mockResolvedValue(raced);
      const update = jest
        .spyOn(orderRepo, 'update')
        .mockResolvedValueOnce({ affected: 1, raw: [], generatedMaps: [] })
        .mockResolvedValueOnce({ affected: 0, raw: [], generatedMaps: [] })
        .mockResolvedValueOnce({ affected: 1, raw: [], generatedMaps: [] });
      jest.spyOn(actionIntegrationFactory, 'getIntegration').mockReturnValue({
        supportedCommands: ['sell'],
        executeOrder: jest.fn(),
        checkCompletion: jest.fn(),
        validateParams: jest.fn(),
        resolveUncertainOrder: jest.fn().mockResolvedValue(UncertainOrderResolution.SENT),
      });

      await expect(service.resolveUncertainOrderManually(9, VERIFIED_DTO, 42)).rejects.toThrow(/held as uncertain/);

      expect(update.mock.calls[2][1]).toMatchObject({ status: LiquidityManagementOrderStatus.UNCERTAIN });
      // the account and reference recorded by whoever released it are still there afterwards
      expect(update.mock.calls[2][1].errorMessage).toContain('account 7');
      expect(update.mock.calls[2][1].errorMessage).toContain('OPS-99');
      expect(notificationService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: 'lm-observation-unapplied-9' }),
      );
    });

    it('accepts a release for an order whose adapter is no longer registered', async () => {
      // nothing can be asked here, so the request is recorded and reconciliation puts it into effect
      const order = Object.assign(new LiquidityManagementOrder(), {
        id: 9,
        status: LiquidityManagementOrderStatus.UNCERTAIN,
        errorMessage: 'unknown',
        action: { id: 233, system: 'Scrypt', command: 'sell' },
      });
      jest.spyOn(orderRepo, 'findOneBy').mockResolvedValue(order);
      jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      jest.spyOn(actionIntegrationFactory, 'getIntegration').mockReturnValue(null);

      await expect(service.resolveUncertainOrderManually(9, VERIFIED_DTO, 42)).resolves.toBeUndefined();

      expect(order.status).toBe(LiquidityManagementOrderStatus.UNCERTAIN);
      expect(order.notSentRecheckDue).toBeInstanceOf(Date);
    });

    it('skips an order another path resolved first, instead of overwriting it', async () => {
      const order = Object.assign(new LiquidityManagementOrder(), {
        id: 9,
        status: LiquidityManagementOrderStatus.UNCERTAIN,
        errorMessage: 'unknown',
      });
      jest.spyOn(orderRepo, 'findOneBy').mockResolvedValue(order);
      jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });
      jest.spyOn(actionIntegrationFactory, 'getIntegration').mockReturnValue({
        supportedCommands: ['sell'],
        executeOrder: jest.fn(),
        checkCompletion: jest.fn(),
        validateParams: jest.fn(),
        resolveUncertainOrder: jest.fn().mockResolvedValue(UncertainOrderResolution.UNRESOLVED),
      });

      await expect(service.resolveUncertainOrderManually(9, VERIFIED_DTO, 42)).rejects.toThrow(/resolved elsewhere/);
    });

    it('records a release and where the check happened, without ending the order yet', async () => {
      const order = Object.assign(new LiquidityManagementOrder(), {
        id: 9,
        status: LiquidityManagementOrderStatus.UNCERTAIN,
        errorMessage: 'Scrypt gave no confirmed outcome',
      });
      jest.spyOn(orderRepo, 'findOneBy').mockResolvedValue(order);
      jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      jest.spyOn(actionIntegrationFactory, 'getIntegration').mockReturnValue({
        supportedCommands: ['sell'],
        executeOrder: jest.fn(),
        checkCompletion: jest.fn(),
        validateParams: jest.fn(),
        resolveUncertainOrder: jest.fn().mockResolvedValue(UncertainOrderResolution.UNRESOLVED),
      });

      await service.resolveUncertainOrderManually(9, VERIFIED_DTO, 42);

      // accepted, but the order keeps blocking until reconciliation has had one answer from the venue
      expect(order.status).toBe(LiquidityManagementOrderStatus.UNCERTAIN);
      expect(order.notSentRecheckDue).toBeInstanceOf(Date);
      expect(order.errorMessage).toContain('venue console, ticket OPS-42');
      expect(order.errorMessage).toContain('account 42');
    });

    it('refuses to touch an order that is not quarantined', async () => {
      const order = Object.assign(new LiquidityManagementOrder(), {
        id: 9,
        status: LiquidityManagementOrderStatus.IN_PROGRESS,
      });
      jest.spyOn(orderRepo, 'findOneBy').mockResolvedValue(order);

      await expect(service.resolveUncertainOrderManually(9, VERIFIED_DTO, 42)).rejects.toThrow(
        /only an uncertain order/,
      );
      expect(order.status).toBe(LiquidityManagementOrderStatus.IN_PROGRESS);
    });

    it('fails loudly for an unknown order', async () => {
      jest.spyOn(orderRepo, 'findOneBy').mockResolvedValue(null);

      await expect(service.resolveUncertainOrderManually(404, VERIFIED_DTO, 42)).rejects.toThrow(
        /No liquidity management order/,
      );
    });
  });

  describe('processPipelines — the observation barrier', () => {
    it('advances nothing while a confirmed observation could not be recorded', async () => {
      // an order may be live at the venue while its row says otherwise; starting or advancing anything on
      // that picture is exactly how a second request goes out
      service['unappliedObservations'].set(1, new LiquidityManagementOrder());
      jest.spyOn(service as any, 'resolveUncertainOrders').mockResolvedValue(false);
      const startNewPipelines = jest.spyOn(service as any, 'startNewPipelines').mockResolvedValue(false);
      const checkRunningOrders = jest.spyOn(service as any, 'checkRunningOrders').mockResolvedValue(false);
      const startNewOrders = jest.spyOn(service as any, 'startNewOrders').mockResolvedValue(false);

      await service.processPipelines();

      expect(startNewPipelines).not.toHaveBeenCalled();
      expect(checkRunningOrders).not.toHaveBeenCalled();
      expect(startNewOrders).not.toHaveBeenCalled();
    });

    it('resumes once the observation has been recorded', async () => {
      jest.spyOn(service as any, 'resolveUncertainOrders').mockResolvedValue(false);
      const startNewPipelines = jest.spyOn(service as any, 'startNewPipelines').mockResolvedValue(false);
      jest.spyOn(service as any, 'checkRunningOrders').mockResolvedValue(false);
      jest.spyOn(service as any, 'checkRunningPipelines').mockResolvedValue(false);
      jest.spyOn(service as any, 'startNewOrders').mockResolvedValue(false);

      await service.processPipelines();

      expect(startNewPipelines).toHaveBeenCalled();
    });
  });

  describe('checkRunningPipelines — quarantined orders', () => {
    it('leaves a pipeline whose last order is UNCERTAIN completely alone', async () => {
      const rule = Object.assign(new LiquidityManagementRule(), { id: 42, sendNotifications: true });
      const pipeline = Object.assign(new LiquidityManagementPipeline(), {
        id: 1,
        status: LiquidityManagementPipelineStatus.IN_PROGRESS,
        currentAction: { id: 233 },
        rule,
      });
      jest.spyOn(pipelineRepo, 'find').mockResolvedValue([pipeline]);
      jest
        .spyOn(orderRepo, 'findOne')
        .mockResolvedValue(
          Object.assign(new LiquidityManagementOrder(), { id: 9, status: LiquidityManagementOrderStatus.UNCERTAIN }),
        );

      const anyChanged = await service['checkRunningPipelines']();

      // no advance, no fail, no new order — and crucially the rule is neither paused nor reactivated,
      // which is what stops an unresolved order from being reissued
      expect(anyChanged).toBe(false);
      expect(pipeline.status).toBe(LiquidityManagementPipelineStatus.IN_PROGRESS);
      expect(pipelineRepo.save).not.toHaveBeenCalled();
      expect(orderRepo.save).not.toHaveBeenCalled();
      expect(ruleRepo.save).not.toHaveBeenCalled();
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });
  });

  describe('handlePipelineFail', () => {
    it('resets the activation debounce timer when a rule is paused', async () => {
      const rule = Object.assign(new LiquidityManagementRule(), {
        id: 42,
        status: LiquidityManagementRuleStatus.PROCESSING,
        sendNotifications: false,
        targetFiat: { name: 'EUR' },
      });
      const pipeline = Object.assign(new LiquidityManagementPipeline(), {
        id: 1,
        type: LiquidityOptimizationType.DEFICIT,
        maxAmount: 100,
        status: LiquidityManagementPipelineStatus.FAILED,
        rule,
      });
      const order = Object.assign(new LiquidityManagementOrder(), { errorMessage: 'order failed' });

      await service['handlePipelineFail'](pipeline, order);

      expect(liquidityManagementService.resetActivation).toHaveBeenCalledWith(42);
      expect(rule.status).toBe(LiquidityManagementRuleStatus.PAUSED);
      expect(ruleRepo.save).toHaveBeenCalledWith(rule);
    });
  });
});
