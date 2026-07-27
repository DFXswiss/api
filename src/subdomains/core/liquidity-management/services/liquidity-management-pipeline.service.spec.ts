import { createMock } from '@golevelup/ts-jest';
import { FindOptionsWhere } from 'typeorm';
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
    function uncertainOrder(): LiquidityManagementOrder {
      return Object.assign(new LiquidityManagementOrder(), {
        id: 9,
        status: LiquidityManagementOrderStatus.UNCERTAIN,
        correlationId: 'dfx-lm-9',
        errorMessage: 'Scrypt did not answer',
        action: { id: 233, system: 'Scrypt', command: 'sell' },
      });
    }

    /** An order a not-sent resolution has already failed — what the reclaim has to be able to take back. */
    function negativelyResolvedOrder(recheckDue = new Date('2026-07-27T20:00:00Z')): LiquidityManagementOrder {
      return Object.assign(uncertainOrder(), {
        status: LiquidityManagementOrderStatus.FAILED,
        errorMessage: 'Scrypt did not answer (venue confirmed the request never arrived) [resolved-as-not-sent]',
        notSentRecheckDue: recheckDue,
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

    it.each([
      [UncertainOrderResolution.SENT, LiquidityManagementOrderStatus.IN_PROGRESS],
      [UncertainOrderResolution.NOT_SENT, LiquidityManagementOrderStatus.FAILED],
      [UncertainOrderResolution.UNRESOLVED, LiquidityManagementOrderStatus.UNCERTAIN],
    ])('moves an order to %s -> %s', async (resolution, expectedStatus) => {
      const order = uncertainOrder();
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      jest.spyOn(actionIntegrationFactory, 'getIntegration').mockReturnValue({
        supportedCommands: ['sell'],
        executeOrder: jest.fn(),
        checkCompletion: jest.fn(),
        validateParams: jest.fn(),
        resolveUncertainOrder: jest.fn().mockResolvedValue(resolution),
      });

      await service['resolveUncertainOrders']();

      expect(order.status).toBe(expectedStatus);
    });

    it('looks at quarantined orders and at not-sent failures still awaiting their one further look', async () => {
      // the second branch is what applies an observation whose writes did not land, and it selects on an
      // indexed marker rather than matching a wildcard against every failure ever recorded
      const findBy = jest.spyOn(orderRepo, 'findBy').mockResolvedValue([]);

      await service['resolveUncertainOrders']();

      const [uncertain, reclaimable] = findBy.mock.calls[0][0] as FindOptionsWhere<LiquidityManagementOrder>[];
      expect(uncertain).toEqual({ status: LiquidityManagementOrderStatus.UNCERTAIN });
      expect(reclaimable.status).toBe(LiquidityManagementOrderStatus.FAILED);
      expect(reclaimable.notSentRecheckDue).toBeDefined();
      expect(reclaimable.errorMessage).toBeUndefined();
    });

    it('releases a not-sent failure from reconciliation once that look has happened', async () => {
      // otherwise the venue would be asked about every settled failure every ten seconds, for good
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([negativelyResolvedOrder()]);
      const update = jest.spyOn(orderRepo, 'update');
      stubIntegration(UncertainOrderResolution.UNRESOLVED);

      await service['resolveUncertainOrders']();

      expect(update).toHaveBeenCalledWith(
        {
          id: 9,
          status: LiquidityManagementOrderStatus.FAILED,
          notSentRecheckDue: new Date('2026-07-27T20:00:00Z'),
        },
        { notSentRecheckDue: null },
      );
    });

    it('cannot clear a newer resolution that was written while it was looking', async () => {
      // the pass holds the marker it started from; a resolution written since owes a look of its own, and
      // dropping ITS marker would discard exactly the obligation this mechanism exists to keep
      const looked = negativelyResolvedOrder(new Date('2026-07-27T20:00:00Z'));
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([looked]);
      const update = jest.spyOn(orderRepo, 'update');
      stubIntegration(UncertainOrderResolution.UNRESOLVED);

      await service['resolveUncertainOrders']();

      const [where] = update.mock.calls[0];
      expect(where).toMatchObject({ notSentRecheckDue: new Date('2026-07-27T20:00:00Z') });
    });

    it('releases a marked failure no integration can ever look up', async () => {
      // otherwise every pass selects the row and skips it again, for as long as the row exists
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([negativelyResolvedOrder()]);
      const update = jest.spyOn(orderRepo, 'update');
      jest.spyOn(actionIntegrationFactory, 'getIntegration').mockReturnValue({
        supportedCommands: ['sell'],
        executeOrder: jest.fn(),
        checkCompletion: jest.fn(),
        validateParams: jest.fn(),
      });

      await service['resolveUncertainOrders']();

      expect(update).toHaveBeenCalledWith(expect.anything(), { notSentRecheckDue: null });
    });

    it('keeps a not-sent failure eligible when the venue confirms the order after all', async () => {
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([negativelyResolvedOrder()]);
      jest.spyOn(orderRepo, 'findOneBy').mockResolvedValue(negativelyResolvedOrder());
      const update = jest
        .spyOn(orderRepo, 'update')
        .mockResolvedValueOnce({ affected: 0, raw: [], generatedMaps: [] })
        .mockResolvedValueOnce({ affected: 1, raw: [], generatedMaps: [] });
      stubIntegration(UncertainOrderResolution.SENT);

      await service['resolveUncertainOrders']();

      expect(update).not.toHaveBeenCalledWith(expect.anything(), { notSentRecheckDue: null });
      expect(update.mock.calls[1][1]).toMatchObject({ status: LiquidityManagementOrderStatus.IN_PROGRESS });
    });

    it('puts a confirmed order back into quarantine when neither release lands', async () => {
      // an alert alone is read at human speed while the rule reactivates in minutes, so the order itself
      // has to go back to a state nothing plans against
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([uncertainOrder()]);
      jest.spyOn(orderRepo, 'findOneBy').mockResolvedValue(negativelyResolvedOrder());
      const update = jest
        .spyOn(orderRepo, 'update')
        .mockResolvedValueOnce({ affected: 0, raw: [], generatedMaps: [] }) // no longer quarantined
        .mockResolvedValueOnce({ affected: 0, raw: [], generatedMaps: [] }) // and the reclaim does not match either
        .mockResolvedValueOnce({ affected: 1, raw: [], generatedMaps: [] }); // so it is blocked again
      stubIntegration(UncertainOrderResolution.SENT);

      await service['resolveUncertainOrders']();

      expect(update.mock.calls[2][1]).toMatchObject({ status: LiquidityManagementOrderStatus.UNCERTAIN });
      // and the reason already on the row survives being held again
      expect(update.mock.calls[2][1].errorMessage).toContain('[resolved-as-not-sent]');
      expect(notificationService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: 'lm-observation-unapplied-9' }),
      );
    });

    it('does the same when the release throws instead of matching nothing', async () => {
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([uncertainOrder()]);
      const update = jest
        .spyOn(orderRepo, 'update')
        .mockRejectedValueOnce(new Error('connection lost'))
        .mockResolvedValueOnce({ affected: 1, raw: [], generatedMaps: [] });
      stubIntegration(UncertainOrderResolution.SENT);

      await service['resolveUncertainOrders']();

      expect(update.mock.calls[1][1]).toMatchObject({ status: LiquidityManagementOrderStatus.UNCERTAIN });
      expect(notificationService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: 'lm-observation-unapplied-9' }),
      );
    });

    it('reports a confirmed order whose state it cannot even read', async () => {
      // the alert must not depend on a second read succeeding — that was the failure it exists to catch
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([uncertainOrder()]);
      jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });
      jest.spyOn(orderRepo, 'findOneBy').mockRejectedValue(new Error('connection lost'));
      stubIntegration(UncertainOrderResolution.SENT);

      await service['resolveUncertainOrders']();

      expect(notificationService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: 'lm-observation-unapplied-9' }),
      );
    });

    it('stays quiet while the order is still quarantined — the next pass simply tries again', async () => {
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([uncertainOrder()]);
      jest
        .spyOn(orderRepo, 'update')
        .mockRejectedValueOnce(new Error('connection lost'))
        .mockResolvedValueOnce({ affected: 0, raw: [], generatedMaps: [] });
      jest.spyOn(orderRepo, 'findOneBy').mockResolvedValue(uncertainOrder());
      stubIntegration(UncertainOrderResolution.SENT);

      await service['resolveUncertainOrders']();

      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('stays quiet when something else had already released the order correctly', async () => {
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([uncertainOrder()]);
      jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });
      jest
        .spyOn(orderRepo, 'findOneBy')
        .mockResolvedValue(Object.assign(uncertainOrder(), { status: LiquidityManagementOrderStatus.IN_PROGRESS }));
      stubIntegration(UncertainOrderResolution.SENT);

      await service['resolveUncertainOrders']();

      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('takes back a not-sent failure once the venue turns out to know the order after all', async () => {
      // the row this pass loaded predates the resolution being overruled, so the reclaim has to write back
      // what the row says NOW — otherwise it erases the operator and the reference behind that judgement
      const stale = Object.assign(uncertainOrder(), { errorMessage: 'Scrypt did not answer' });
      const written = Object.assign(negativelyResolvedOrder(), {
        errorMessage:
          'Scrypt did not answer (manually resolved by account 42: venue checked, no execution found — ' +
          'ticket OPS-1234) [resolved-as-not-sent]',
      });
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([stale]);
      jest.spyOn(orderRepo, 'findOneBy').mockResolvedValue(written);
      const update = jest
        .spyOn(orderRepo, 'update')
        // the release is skipped — this order is no longer quarantined — and the reclaim catches it instead
        .mockResolvedValueOnce({ affected: 0, raw: [], generatedMaps: [] })
        .mockResolvedValueOnce({ affected: 1, raw: [], generatedMaps: [] });
      stubIntegration(UncertainOrderResolution.SENT);

      await service['resolveUncertainOrders']();

      expect(update).toHaveBeenCalledTimes(2);
      expect(update.mock.calls[1][1]).toMatchObject({ status: LiquidityManagementOrderStatus.IN_PROGRESS });
      expect(update.mock.calls[1][1].errorMessage).toContain('account 42');
      expect(update.mock.calls[1][1].errorMessage).toContain('OPS-1234');
      expect(notificationService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: 'lm-order-reinstated-9' }),
      );
    });

    it('marks a not-sent resolution so it gets that one further look', async () => {
      const order = uncertainOrder();
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      const update = jest.spyOn(orderRepo, 'update');
      stubIntegration(UncertainOrderResolution.NOT_SENT);

      await service['resolveUncertainOrders']();

      expect(order.notSentRecheckDue).toBeInstanceOf(Date);
      expect(update.mock.calls[0][1]).toMatchObject({ notSentRecheckDue: order.notSentRecheckDue });
      // and the moment itself goes into the reason, which nothing clears
      expect(order.errorMessage).toMatch(/never arrived, \d{4}-\d{2}-\d{2}T/);
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
        errorMessage: 'unknown (manually resolved by account 7: venue checked — ticket OPS-99) [resolved-as-not-sent]',
        action: { id: 233, system: 'Scrypt', command: 'sell' },
      });
      jest.spyOn(orderRepo, 'findOneBy').mockResolvedValueOnce(order).mockResolvedValue(raced);
      const update = jest
        .spyOn(orderRepo, 'update')
        .mockResolvedValueOnce({ affected: 0, raw: [], generatedMaps: [] })
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

    it('releases a quarantined order and records where the check happened', async () => {
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

      expect(order.status).toBe(LiquidityManagementOrderStatus.FAILED);
      expect(order.errorMessage).toContain('venue console, ticket OPS-42');
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
