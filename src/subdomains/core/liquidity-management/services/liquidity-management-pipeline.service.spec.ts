import { createMock } from '@golevelup/ts-jest';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { FindOperator } from 'typeorm';
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
        updated: new Date(Date.now() - 60_000),
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

    /** `cancelSettles` is what the venue says when asked to make sure nothing can execute any more.
     * true → reason string (exit), false → null (no exit). The pipeline now receives the reason from the
     * integration rather than inventing one. */
    function stubIntegration(resolution: UncertainOrderResolution, cancelSettles = true): void {
      // resolveUncertainOrders looks up the venue via getReconciliationIntegration (system-only). The SENT
      // path additionally consults getIntegration: only a registered command may return to IN_PROGRESS.
      // Stub both with the same adapter so existing tests model the normal registered-command case they
      // always intended (command: 'sell' / supportedCommands: ['sell']).
      const integration = {
        supportedCommands: ['sell'],
        executeOrder: jest.fn(),
        checkCompletion: jest.fn(),
        validateParams: jest.fn(),
        resolveUncertainOrder: jest.fn().mockResolvedValue(resolution),
        cancelOutstanding: jest
          .fn()
          .mockResolvedValue(
            cancelSettles ? 'the venue answered for every reference that nothing is left to execute' : null,
          ),
      };
      jest.spyOn(actionIntegrationFactory, 'getReconciliationIntegration').mockReturnValue(integration);
      jest.spyOn(actionIntegrationFactory, 'getIntegration').mockReturnValue(integration);
    }

    it('only ever asks about quarantined orders', async () => {
      const findBy = jest.spyOn(orderRepo, 'findBy').mockResolvedValue([]);

      await service['resolveUncertainOrders']();

      expect(findBy).toHaveBeenCalledWith({ status: LiquidityManagementOrderStatus.UNCERTAIN });
    });

    // SENT → IN_PROGRESS covers FIX 1 normal case (command still registered via stubIntegration's
    // getIntegration mock). The unregistered-command SENT case is asserted separately below.
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

    /** Quarantined `minutes` ago — the clock runs from `updated`, not from creation. */
    function agedOrder(minutes: number, command = 'sell', system = 'Scrypt'): LiquidityManagementOrder {
      return uncertainOrder({
        created: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        updated: new Date(Date.now() - minutes * 60 * 1000),
        action: { id: 233, system, command } as LiquidityManagementOrder['action'],
      });
    }

    function expectResolution(order: LiquidityManagementOrder, resolution: UncertainOrderResolution): void {
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      stubIntegration(resolution);
    }

    // both allowlist entries, so dropping or mistyping either one is caught
    it.each(['sell', 'buy'])(
      'abandons a %s past its bound once the venue settles every reference, so its rule is not blocked forever',
      async (command) => {
        // the failure this prevents: nobody releases the order by hand, so it stays UNCERTAIN indefinitely
        // and the rule behind it never plans again — the venue silently stops being served
        const order = agedOrder(30, command);
        expectResolution(order, UncertainOrderResolution.UNRESOLVED);

        await service['resolveUncertainOrders']();

        expect(order.status).toBe(LiquidityManagementOrderStatus.FAILED);
        // the record must not claim an observation nobody made
        expect(order.errorMessage).toContain('answered for every reference');
      },
    );

    it('acts on a release immediately when the order carries no reference to look up', async () => {
      // an unaskable order reports UNAVAILABLE, so without this the release would sit out the full
      // unreachable-venue wait for an answer that can never arrive — somebody already checked by hand
      const order = uncertainOrder({ correlationId: undefined, notSentRecheckDue: RELEASED_AT });
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      stubIntegration(UncertainOrderResolution.UNAVAILABLE);

      await service['resolveUncertainOrders']();

      expect(order.status).toBe(LiquidityManagementOrderStatus.FAILED);
      expect(order.errorMessage).toContain('no reference exists to look it up');
    });

    it('lets a human release win over the clock when both would apply', async () => {
      // Two exits apply here and they record different verdicts: the release says the venue confirmed the
      // request never arrived, the abandon says only that nothing is left to execute. The operator's own
      // reason survives either way — both prefix the existing message rather than replacing it — but which
      // verdict is added to it matters, and only the release rests on somebody having actually checked. The
      // branch order decides that, so it is asserted here: reordering the chain later must not quietly file
      // an audited case under the weaker of the two.
      const order = agedOrder(30);
      order.notSentRecheckDue = RELEASED_AT;
      order.errorMessage = 'Scrypt did not answer (released by account 42: venue checked — ticket OPS-42)';
      expectResolution(order, UncertainOrderResolution.UNRESOLVED);

      await service['resolveUncertainOrders']();

      expect(order.status).toBe(LiquidityManagementOrderStatus.FAILED);
      expect(order.errorMessage).toContain('the venue has no record of it either');
      expect(order.errorMessage).not.toContain('abandoned');
    });

    it('does not abandon while the venue will not settle its references', async () => {
      // the only thing that makes giving up dangerous is a request that can still execute. If the venue
      // will not confirm that none can — unreachable, or an order it reports in another state — then the
      // order keeps waiting. Nothing is concluded from that silence, which is the point.
      const order = agedOrder(30);
      expectResolution(order, UncertainOrderResolution.UNRESOLVED);
      stubIntegration(UncertainOrderResolution.UNRESOLVED, false);

      await service['resolveUncertainOrders']();

      expect(order.status).toBe(LiquidityManagementOrderStatus.UNCERTAIN);
    });

    it('abandons an order whose references the venue settled, whatever the lookup said', async () => {
      // the cancel is what settles it, so an inconclusive lookup is no obstacle: once nothing can execute,
      // giving up is a fact rather than an estimate
      const order = agedOrder(30);
      expectResolution(order, UncertainOrderResolution.UNAVAILABLE);

      await service['resolveUncertainOrders']();

      expect(order.status).toBe(LiquidityManagementOrderStatus.FAILED);
    });

    it('keeps a trade quarantined inside its bound — the slowest observed trade took under a minute', async () => {
      const order = agedOrder(1);
      expectResolution(order, UncertainOrderResolution.UNRESOLVED);

      await service['resolveUncertainOrders']();

      expect(order.status).toBe(LiquidityManagementOrderStatus.UNCERTAIN);
    });

    it('holds a withdrawal far longer than a trade — its p95 alone is over an hour', async () => {
      // a withdrawal at 30 minutes is entirely normal; abandoning it here would reissue a live transfer
      const order = agedOrder(30, 'withdraw');
      expectResolution(order, UncertainOrderResolution.UNRESOLVED);

      await service['resolveUncertainOrders']();

      expect(order.status).toBe(LiquidityManagementOrderStatus.UNCERTAIN);
    });

    it('abandons a transfer once even its long bound has run out and the venue settles it', async () => {
      // the bound alone is not enough: this asserts the pipeline's side of the contract, that an aged
      // transfer whose integration returns a reason string from cancelOutstanding does get abandoned.
      // How the integration settles the question (trade cancel vs. a withdrawal history reply that does not name it)
      // is its business — the pipeline only forwards the returned reason.
      const order = agedOrder(13 * 60, 'withdraw');
      expectResolution(order, UncertainOrderResolution.UNRESOLVED);

      await service['resolveUncertainOrders']();

      expect(order.status).toBe(LiquidityManagementOrderStatus.FAILED);
      expect(order.errorMessage).toContain('answered for every reference');
    });

    it('gives an unrecognised command the long bound, not the short one', async () => {
      // allowlist, not denylist: a new adapter must not inherit the trade bound by accident
      const order = agedOrder(30, 'some-new-bridge-command');
      expectResolution(order, UncertainOrderResolution.UNRESOLVED);

      await service['resolveUncertainOrders']();

      expect(order.status).toBe(LiquidityManagementOrderStatus.UNCERTAIN);
    });

    it('never abandons an order no integration can look up, however old', async () => {
      // the venue is never asked here, so only the clock would be left — and the safety of abandoning rests
      // on replanning against a balance that reflects an execution. A chain balance omits unconfirmed
      // transactions and a bank balance comes from the last import, so that does not hold off-exchange.
      const order = agedOrder(30 * 24 * 60);
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      jest.spyOn(actionIntegrationFactory, 'getReconciliationIntegration').mockReturnValue(undefined);

      await service['resolveUncertainOrders']();

      expect(order.status).toBe(LiquidityManagementOrderStatus.UNCERTAIN);
    });

    it('gives an on-chain swap the long bound even though its command is called "sell"', async () => {
      // the command name alone does not say what an action does: DfxDex/sell is an on-chain swap with a
      // confirmation time, not a book match settled in seconds
      const order = agedOrder(30, 'sell', 'DfxDex');
      expectResolution(order, UncertainOrderResolution.UNRESOLVED);

      await service['resolveUncertainOrders']();

      expect(order.status).toBe(LiquidityManagementOrderStatus.UNCERTAIN);
    });

    it('narrows an abandon on the absent release as SQL NULL, not as a bare null', async () => {
      // the abandon concludes nothing about the send itself, so it must not outrank an operator who checked and is
      // still owed one venue answer — hence the narrowing. But "no release pending" is the ordinary case
      // here, and a raw null renders as `= NULL`, which matches no row at all: the update would never
      // affect anything and would report itself as a lost race. A mocked repo cannot see that, so assert
      // on the operator itself.
      const order = agedOrder(30);
      const update = jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      stubIntegration(UncertainOrderResolution.UNRESOLVED);

      await service['resolveUncertainOrders']();

      const criteria = update.mock.calls[0][0] as { notSentRecheckDue: FindOperator<Date> };
      expect(criteria.notSentRecheckDue).toBeInstanceOf(FindOperator);
      expect(criteria.notSentRecheckDue.type).toBe('isNull');
      expect(order.status).toBe(LiquidityManagementOrderStatus.FAILED);
    });

    it('narrows a not-sent verdict on the absent release as SQL NULL too', async () => {
      // the same trap on the other caller: a venue verdict arrives with nobody having released the order,
      // so its examined value is null as well. Asserting on status alone would not catch a regression here,
      // because resolveAsNotSent already sets FAILED synchronously before the write is attempted.
      const order = uncertainOrder();
      const update = jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      stubIntegration(UncertainOrderResolution.NOT_SENT);

      await service['resolveUncertainOrders']();

      const criteria = update.mock.calls[0][0] as { notSentRecheckDue: FindOperator<Date> };
      expect(criteria.notSentRecheckDue).toBeInstanceOf(FindOperator);
      expect(criteria.notSentRecheckDue.type).toBe('isNull');
    });

    it('runs the abandon clock off `created` once `updated` is missing, because created is always the older (or equal) bound', async () => {
      // entity copy() clears `updated`, and some raw loads omit the column — `created` stays the only
      // clock left. It is never younger than `updated` would have been, so falling back to it can only make
      // the bound expire earlier, never later: the one direction that keeps giving up safe.
      const order = uncertainOrder({ updated: undefined });
      expectResolution(order, UncertainOrderResolution.UNRESOLVED);

      await service['resolveUncertainOrders']();

      // ORDER_CREATED is 29 days old, decisively past the 5-minute trade bound
      expect(order.status).toBe(LiquidityManagementOrderStatus.FAILED);
    });

    it('never abandons an order with neither a quarantine timestamp nor a creation date', async () => {
      // Util.minutesDiff reads a missing date as the epoch; unguarded that abandons instantly. `created` is
      // the last fallback, and losing that too must leave no clock at all — the order can only wait.
      //
      // Routed through a pending release (rather than a bare uncertainOrder()) so the pass takes the
      // releasePending branch: that branch never reads order.created for the cooldown throttle, so this
      // reaches unresolvableTooLong()'s own missing-date guard instead of the unrelated crash a bare
      // uncertain order with no `created` would hit in the age-based throttle a few lines above it.
      const order = uncertainOrder({ updated: undefined, created: undefined, notSentRecheckDue: RELEASED_AT });
      stubIntegration(UncertainOrderResolution.UNAVAILABLE);
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);

      await service['resolveUncertainOrders']();

      expect(order.status).toBe(LiquidityManagementOrderStatus.UNCERTAIN);
      expect(orderRepo.update).not.toHaveBeenCalled();
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

    it('does not report a missed quarantine write as a resolution that happened elsewhere', async () => {
      // The write cannot tell a race from a narrowing that will never match again, and the second case repeats
      // forever while the order stays as it is. Claiming the benign one hid exactly that: a release timestamp
      // with microsecond precision is unmatchable by a JS Date, and it held a live order for hours behind the
      // reassuring wording. So the line must name both and be a warning, not routine information.
      const order = releasePendingOrder();
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });
      const warn = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
      stubIntegration(UncertainOrderResolution.UNRESOLVED);

      await service['resolveUncertainOrders']();

      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/was not updated.*resolved elsewhere.*matched no row/s));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('stuck'));
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
      jest.spyOn(actionIntegrationFactory, 'getReconciliationIntegration').mockReturnValue(null);

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
      jest.spyOn(actionIntegrationFactory, 'getReconciliationIntegration').mockReturnValue(null);

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
      jest.spyOn(actionIntegrationFactory, 'getReconciliationIntegration').mockReturnValue({
        supportedCommands: ['sell'],
        executeOrder: jest.fn(),
        checkCompletion: jest.fn(),
        validateParams: jest.fn(),
        resolveUncertainOrder: jest.fn().mockRejectedValue(new Error('venue unreachable')),
      });

      await service['resolveUncertainOrders']();

      expect(order.status).toBe(LiquidityManagementOrderStatus.UNCERTAIN);
    });

    it('reaches the adapter for a Scrypt order whose command is no longer registered', async () => {
      // getIntegration would return null for an unregistered command; reconciliation resolves by system
      const resolveUncertainOrder = jest.fn().mockResolvedValue(UncertainOrderResolution.UNRESOLVED);
      const cancelOutstanding = jest.fn().mockResolvedValue(null);
      jest.spyOn(actionIntegrationFactory, 'getReconciliationIntegration').mockReturnValue({
        supportedCommands: ['sell', 'buy', 'withdraw'], // deliberately omits the order's command
        executeOrder: jest.fn(),
        checkCompletion: jest.fn(),
        validateParams: jest.fn(),
        resolveUncertainOrder,
        cancelOutstanding,
      });
      // getIntegration would skip — prove reconciliation does not use it for this path
      jest.spyOn(actionIntegrationFactory, 'getIntegration').mockReturnValue(null);
      const order = agedOrder(30, 'sell-if-deficit', 'Scrypt');
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      await service['resolveUncertainOrders']();

      expect(resolveUncertainOrder).toHaveBeenCalledWith(order);
    });

    it('keeps a venue-confirmed SENT order quarantined when its command is no longer registered', async () => {
      // Venue knows the reference, but no registered command can checkCompletion. Returning to IN_PROGRESS
      // would trap the order (see FIX 1); stay UNCERTAIN so the automatic abandon path remains available.
      const resolveUncertainOrder = jest.fn().mockResolvedValue(UncertainOrderResolution.SENT);
      const cancelOutstanding = jest.fn().mockResolvedValue(null);
      jest.spyOn(actionIntegrationFactory, 'getReconciliationIntegration').mockReturnValue({
        supportedCommands: ['sell', 'buy', 'withdraw'], // deliberately omits the order's command
        executeOrder: jest.fn(),
        checkCompletion: jest.fn(),
        validateParams: jest.fn(),
        resolveUncertainOrder,
        cancelOutstanding,
      });
      jest.spyOn(actionIntegrationFactory, 'getIntegration').mockReturnValue(null);
      const order = agedOrder(30, 'sell-if-deficit', 'Scrypt');
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      const warn = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

      await service['resolveUncertainOrders']();

      expect(order.status).toBe(LiquidityManagementOrderStatus.UNCERTAIN);
      expect(order.status).not.toBe(LiquidityManagementOrderStatus.IN_PROGRESS);
      expect(resolveUncertainOrder).toHaveBeenCalledWith(order);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/stays quarantined.*no registered command/s));
      expect(cancelOutstanding).not.toHaveBeenCalled();
    });

    it('abandons a venue-confirmed SENT order past its bound when its command is no longer registered', async () => {
      const resolveUncertainOrder = jest.fn().mockResolvedValue(UncertainOrderResolution.SENT);
      const cancelOutstanding = jest
        .fn()
        .mockResolvedValue('the venue answered for every reference that nothing is left to execute');
      jest.spyOn(actionIntegrationFactory, 'getReconciliationIntegration').mockReturnValue({
        supportedCommands: ['sell', 'buy', 'withdraw'], // deliberately omits the order's command
        executeOrder: jest.fn(),
        checkCompletion: jest.fn(),
        validateParams: jest.fn(),
        resolveUncertainOrder,
        cancelOutstanding,
      });
      jest.spyOn(actionIntegrationFactory, 'getIntegration').mockReturnValue(null);
      const order = agedOrder(30, 'sell', 'Scrypt');
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

      await service['resolveUncertainOrders']();

      expect(cancelOutstanding).toHaveBeenCalledWith(order);
      expect(order.status).toBe(LiquidityManagementOrderStatus.FAILED);
      expect(order.errorMessage).toContain('the venue answered for every reference that nothing is left to execute');
    });

    it('keeps a venue-confirmed SENT order past its bound quarantined when cancelOutstanding is unsettled', async () => {
      const resolveUncertainOrder = jest.fn().mockResolvedValue(UncertainOrderResolution.SENT);
      const cancelOutstanding = jest.fn().mockResolvedValue(null);
      jest.spyOn(actionIntegrationFactory, 'getReconciliationIntegration').mockReturnValue({
        supportedCommands: ['sell', 'buy', 'withdraw'], // deliberately omits the order's command
        executeOrder: jest.fn(),
        checkCompletion: jest.fn(),
        validateParams: jest.fn(),
        resolveUncertainOrder,
        cancelOutstanding,
      });
      jest.spyOn(actionIntegrationFactory, 'getIntegration').mockReturnValue(null);
      const order = agedOrder(30, 'sell', 'Scrypt');
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

      await service['resolveUncertainOrders']();

      expect(cancelOutstanding).toHaveBeenCalledWith(order);
      expect(order.status).toBe(LiquidityManagementOrderStatus.UNCERTAIN);
    });

    it('abandons a released venue-confirmed SENT order past its bound via cancelOutstanding, not completeNotSentRelease', async () => {
      const resolveUncertainOrder = jest.fn().mockResolvedValue(UncertainOrderResolution.SENT);
      const cancelOutstanding = jest
        .fn()
        .mockResolvedValue('the venue answered for every reference that nothing is left to execute');
      jest.spyOn(actionIntegrationFactory, 'getReconciliationIntegration').mockReturnValue({
        supportedCommands: ['sell', 'buy', 'withdraw'], // deliberately omits the order's command
        executeOrder: jest.fn(),
        checkCompletion: jest.fn(),
        validateParams: jest.fn(),
        resolveUncertainOrder,
        cancelOutstanding,
      });
      jest.spyOn(actionIntegrationFactory, 'getIntegration').mockReturnValue(null);
      const order = agedOrder(30, 'sell', 'Scrypt');
      order.notSentRecheckDue = RELEASED_AT;
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

      await service['resolveUncertainOrders']();

      expect(cancelOutstanding).toHaveBeenCalledWith(order);
      expect(order.status).toBe(LiquidityManagementOrderStatus.FAILED);
      expect(order.errorMessage).toContain('the venue answered for every reference that nothing is left to execute');
      expect(order.errorMessage).not.toContain('the venue confirmed the request never arrived');
    });

    it('leaves a non-Scrypt system without resolveUncertainOrder alone (no automatic progress)', async () => {
      // observable behaviour unchanged vs getIntegration: adapter exists but offers no reconciliation
      jest.spyOn(actionIntegrationFactory, 'getReconciliationIntegration').mockReturnValue({
        supportedCommands: ['transfer'],
        executeOrder: jest.fn(),
        checkCompletion: jest.fn(),
        validateParams: jest.fn(),
        // no resolveUncertainOrder
      });
      const order = agedOrder(30 * 24 * 60, 'transfer', 'SomeBank');
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);

      await service['resolveUncertainOrders']();

      expect(order.status).toBe(LiquidityManagementOrderStatus.UNCERTAIN);
      expect(orderRepo.update).not.toHaveBeenCalled();
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
        jest.spyOn(actionIntegrationFactory, 'getReconciliationIntegration').mockReturnValue({
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
        const order = uncertainOrder({
          created: new Date(Date.now() - 100 * 60_000),
          action: { id: 233, system: 'Scrypt', command: 'withdraw' } as LiquidityManagementOrder['action'],
        });
        jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);

        await service['resolveUncertainOrders']();

        jest.advanceTimersByTime(11 * 60_000);
        await service['resolveUncertainOrders']();
        expect(resolveUncertainOrder).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(20_000);
        await service['resolveUncertainOrders']();
        expect(resolveUncertainOrder).toHaveBeenCalledTimes(2);
      });

      it('holds the deadline cap still between lookups instead of letting it shrink', async () => {
        // The cap is the time that was left when the last lookup finished. Read fresh on every tick it would
        // shrink while the wait grows, the two would meet halfway, and a five-minute bound would be re-asked
        // at 2.5 minutes — then 3.75, then 4.4, a geometric series of expensive lookups before a deadline that
        // never moved. Asserted just before the bound, where the shrinking variant asks and this one does not.
        const order = agedOrder(0);
        const resolveUncertainOrder = jest.fn().mockResolvedValue(UncertainOrderResolution.UNAVAILABLE);
        jest.spyOn(actionIntegrationFactory, 'getReconciliationIntegration').mockReturnValue({
          supportedCommands: ['sell'],
          executeOrder: jest.fn(),
          checkCompletion: jest.fn(),
          validateParams: jest.fn(),
          resolveUncertainOrder,
        });
        jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);

        await service['resolveUncertainOrders']();
        expect(resolveUncertainOrder).toHaveBeenCalledTimes(1);

        // half the bound: exactly where a cap re-read on this tick would coincide with the elapsed wait
        jest.advanceTimersByTime(2.5 * 60_000);
        await service['resolveUncertainOrders']();
        expect(resolveUncertainOrder).toHaveBeenCalledTimes(1);

        // one millisecond short of the bound — still nothing to give up, so still nothing to ask
        jest.advanceTimersByTime(2.5 * 60_000 - 1);
        await service['resolveUncertainOrders']();
        expect(resolveUncertainOrder).toHaveBeenCalledTimes(1);

        // and exactly at the bound it asks, which is what the cap exists to guarantee
        jest.advanceTimersByTime(1);
        await service['resolveUncertainOrders']();
        expect(resolveUncertainOrder).toHaveBeenCalledTimes(2);
      });

      it('does not let its own floor push the abandonment past the deadline', async () => {
        // A lookup that runs shortly before the bound has less than a floor's worth of time left. Raising the cap
        // to the floor there schedules the next pass after the deadline — the overshoot the cap exists to prevent,
        // caused by the cap. Reached the way it happens in practice: the order enters this pass already close to
        // its bound, with no cooldown recorded, so the first lookup lands 30 seconds short of it.
        const order = agedOrder(4.5);
        jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
        jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
        stubIntegration(UncertainOrderResolution.UNRESOLVED);

        // first lookup at 4:30, which stamps the cooldown with only 30 seconds of headroom left
        await service['resolveUncertainOrders']();
        expect(order.status).toBe(LiquidityManagementOrderStatus.UNCERTAIN);

        // at the bound the order must be gone — a floor measured from 4:30 would hold it until 5:30
        jest.advanceTimersByTime(30_000);
        await service['resolveUncertainOrders']();

        expect(order.status).toBe(LiquidityManagementOrderStatus.FAILED);
      });

      it('never throttles past the bound at which the order becomes abandonable', async () => {
        // Where the cooldown and the abandon bound meet. This same pass is what gives an expired order up, so
        // a wait longer than what is left of its bound postpones the abandonment — an order weeks old draws
        // the full thirty-minute interval, six times a trade's own five-minute bound, and the ceiling this
        // branch exists to impose would have been raised with nothing saying so.
        const order = agedOrder(0);
        jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
        jest.spyOn(orderRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
        stubIntegration(UncertainOrderResolution.UNRESOLVED);

        // inside the bound: nothing to give up yet
        await service['resolveUncertainOrders']();
        expect(order.status).toBe(LiquidityManagementOrderStatus.UNCERTAIN);

        // past the bound, still far short of the thirty-minute cap that would otherwise still be running
        jest.advanceTimersByTime(6 * 60_000);
        await service['resolveUncertainOrders']();

        expect(order.status).toBe(LiquidityManagementOrderStatus.FAILED);
      });

      it("leaves the cap governing when the order's own bound is further off than the cap", async () => {
        // The deadline only ever tightens the interval, never loosens it: a transfer has twelve hours, so the
        // cap decides exactly as it did before, and a lookup one millisecond early still must not happen.
        const order = agedOrder(0, 'withdraw');
        const resolveUncertainOrder = jest.fn().mockResolvedValue(UncertainOrderResolution.UNAVAILABLE);
        jest.spyOn(actionIntegrationFactory, 'getReconciliationIntegration').mockReturnValue({
          supportedCommands: ['withdraw'],
          executeOrder: jest.fn(),
          checkCompletion: jest.fn(),
          validateParams: jest.fn(),
          resolveUncertainOrder,
        });
        jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);

        await service['resolveUncertainOrders']();

        jest.advanceTimersByTime(30 * 60_000 - 1);
        await service['resolveUncertainOrders']();
        expect(resolveUncertainOrder).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(1);
        await service['resolveUncertainOrders']();
        expect(resolveUncertainOrder).toHaveBeenCalledTimes(2);
      });

      it('caps the cooldown interval at thirty minutes no matter how old the order is', async () => {
        // Pins the cap to the millisecond. An 8-hour-old order's uncapped wait would be 48 minutes at the
        // first pass and 51 by the time of the boundary check — either way far past the cap, so a lookup at
        // exactly 30 minutes can only come from it. Requiring no lookup a millisecond earlier leaves the cap
        // no other whole-millisecond value to take, and landing on the boundary pins `<` against `<=`.
        const resolveUncertainOrder = stubResolver();
        const order = uncertainOrder({
          created: new Date(Date.now() - 8 * 60 * 60_000),
          action: { id: 233, system: 'Scrypt', command: 'withdraw' } as LiquidityManagementOrder['action'],
        });
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

  describe('checkRunningOrders', () => {
    it('quarantines a running order whose command is no longer registered', async () => {
      // Without the null guard in checkOrder this would TypeError, land only in logger.error, and leave the
      // order stuck in IN_PROGRESS with no automatic or manual exit. OrderOutcomeUnknownException is the
      // same path startNewOrders already uses for unknown outcomes — quarantine, not a hang.
      const order = Object.assign(new LiquidityManagementOrder(), {
        id: 11,
        status: LiquidityManagementOrderStatus.IN_PROGRESS,
        correlationId: 'dfx-lm-11',
        action: { id: 233, system: 'Scrypt', command: 'sell-if-deficit' },
      });
      jest.spyOn(orderRepo, 'findBy').mockResolvedValue([order]);
      jest.spyOn(orderRepo, 'save').mockImplementation(async (o: LiquidityManagementOrder) => o);
      jest.spyOn(actionIntegrationFactory, 'getIntegration').mockReturnValue(null);

      await service['checkRunningOrders']();

      expect(order.status).toBe(LiquidityManagementOrderStatus.UNCERTAIN);
      expect(order.errorMessage).toMatch(/no registered integration.*Scrypt\/sell-if-deficit/s);
      expect(notificationService.sendMail).toHaveBeenCalled();
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
