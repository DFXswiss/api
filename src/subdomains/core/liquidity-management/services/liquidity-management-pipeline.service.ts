import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailRequest } from 'src/subdomains/supporting/notification/interfaces';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { In } from 'typeorm';
import { ResolveUncertainOrderDto } from '../dto/resolve-uncertain-order.dto';
import { LiquidityManagementOrder } from '../entities/liquidity-management-order.entity';
import { LiquidityManagementPipeline } from '../entities/liquidity-management-pipeline.entity';
import { LiquidityManagementOrderStatus, LiquidityManagementPipelineStatus, UncertainOrderResolution } from '../enums';
import { OrderFailedException } from '../exceptions/order-failed.exception';
import { OrderNotNecessaryException } from '../exceptions/order-not-necessary.exception';
import { OrderNotProcessableException } from '../exceptions/order-not-processable.exception';
import { OrderOutcomeUnknownException } from '../exceptions/order-outcome-unknown.exception';
import { LiquidityActionIntegrationFactory } from '../factories/liquidity-action-integration.factory';
import { LiquidityManagementOrderRepository } from '../repositories/liquidity-management-order.repository';
import { LiquidityManagementPipelineRepository } from '../repositories/liquidity-management-pipeline.repository';
import { LiquidityManagementRuleRepository } from '../repositories/liquidity-management-rule.repository';
import { LiquidityManagementService } from './liquidity-management.service';

/**
 * How long reconciliation waits before asking the venue about the same quarantined order again,
 * proportional to the order's age (a tenth of it, within these bounds).
 *
 * A venue lookup is not free: for an order the venue does not know it is a full history fetch, carried over
 * the very connection whose failure usually caused the quarantine in the first place. Asking on every pass
 * is what turned one permanently-absent reference into hundreds of heavy fetches per hour. The interval is
 * age-proportional because the value of asking decays with age: a freshly quarantined order's answer can
 * still change — the venue may simply not have published the reference yet, and fast auto-heal matters —
 * while an order that has been absent for eight hours is not going to answer differently within a minute.
 */
const UNCERTAIN_RESOLVE_MIN_INTERVAL_MS = 60_000; // 1 minute
const UNCERTAIN_RESOLVE_MAX_INTERVAL_MS = 30 * 60_000; // 30 minutes

@Injectable()
export class LiquidityManagementPipelineService {
  private readonly logger = new DfxLogger(LiquidityManagementPipelineService);

  /**
   * Confirmed venue observations this process has not managed to write down yet.
   *
   * A statement that fails must not be the end of one. The order it belongs to would stay terminal while the
   * venue works it, and nothing selects a terminal row again — so the write is kept and simply retried until
   * it lands. A retry here asks the venue nothing; it only repeats what is already known.
   *
   * Held in memory on purpose. The alternative is a durable queue whose rows nothing ever drains, and the
   * case this cannot cover — the process ending first — is the case the alert raised alongside it covers:
   * somebody has been told, by name and reference, to treat the order as live.
   */
  private readonly unappliedObservations = new Map<number, LiquidityManagementOrder>();

  /**
   * When the venue lookup for each quarantined order last FINISHED — the clock behind the resolve cooldown.
   *
   * The end of the attempt, not its start: a slow lookup that finishes just before the next pass must not
   * permit immediate re-entry. In memory like `unappliedObservations`, and safe there for the same reason —
   * losing it on a restart only means one extra lookup per order, never a wrong conclusion. A stamp lives
   * for one quarantine episode: it is cleared when the order's exit write lands, so a re-quarantined order
   * starts fresh, with the per-pass prune against the loaded quarantine set as the safety net for orders
   * that leave any other way.
   */
  private readonly uncertainResolveAttempts = new Map<number, Date>(); // orderId -> last attempt END

  constructor(
    private readonly ruleRepo: LiquidityManagementRuleRepository,
    private readonly orderRepo: LiquidityManagementOrderRepository,
    private readonly pipelineRepo: LiquidityManagementPipelineRepository,
    private readonly actionIntegrationFactory: LiquidityActionIntegrationFactory,
    private readonly notificationService: NotificationService,
    private readonly liquidityManagementService: LiquidityManagementService,
  ) {}

  //*** JOBS ***//

  @DfxCron(CronExpression.EVERY_10_SECONDS, { process: Process.LIQUIDITY_MANAGEMENT, timeout: 1800 })
  async processPipelines(): Promise<void> {
    let hasChanges = true;
    while (hasChanges) {
      // reconcile before issuing anything new: an order whose outcome we could not observe must be
      // accounted for against the venue before the same rule is allowed to act again
      const uncertainResolved = await this.resolveUncertainOrders();

      // A venue observation this process holds but could not write means at least one order may be live at
      // the venue while its row says otherwise. Nothing downstream may run on that picture — starting or
      // advancing anything now is exactly how a second request goes out — so the pass stops here and the
      // next one retries the write first.
      if (this.unappliedObservations.size) {
        this.logger.error(
          `Holding the liquidity pipeline: ${this.unappliedObservations.size} confirmed venue observation(s) could not be recorded`,
        );
        return;
      }

      const newPipelinesStarted = await this.startNewPipelines();
      const ordersChanged = await this.checkRunningOrders();
      const pipelinesChanged = await this.checkRunningPipelines();
      const newOrdersStarted = await this.startNewOrders();

      hasChanges = uncertainResolved || newPipelinesStarted || ordersChanged || pipelinesChanged || newOrdersStarted;
    }
  }

  //*** PUBLIC API ***//

  async getProcessingPipelines(): Promise<LiquidityManagementPipeline[]> {
    return this.pipelineRepo.findBy({
      status: In([LiquidityManagementPipelineStatus.CREATED, LiquidityManagementPipelineStatus.IN_PROGRESS]),
    });
  }

  async getStoppedPipelines(): Promise<LiquidityManagementPipeline[]> {
    return this.pipelineRepo.findBy({
      status: LiquidityManagementPipelineStatus.STOPPED,
    });
  }

  async getProcessingOrders(): Promise<LiquidityManagementOrder[]> {
    return this.orderRepo.findBy({
      // a quarantined order is unfinished business, not a closed one — it belongs in this view
      status: In([
        LiquidityManagementOrderStatus.CREATED,
        LiquidityManagementOrderStatus.IN_PROGRESS,
        LiquidityManagementOrderStatus.UNCERTAIN,
      ]),
    });
  }

  async getPendingTx(): Promise<LiquidityManagementOrder[]> {
    return this.orderRepo.findBy({
      // Deliberately WITHOUT the quarantined status. The financial log adds a pending amount back to the
      // balance and nets it against the venue's locked funds — which works for an order the venue really is
      // holding. For a quarantined order there may be nothing locked, so counting it would inflate equity by
      // its full amount. Overstating equity is the one error direction that can hide a real loss from the
      // safety threshold, so an unresolved order is left out until reconciliation says it was sent.
      status: LiquidityManagementOrderStatus.IN_PROGRESS,
      action: { command: In(['withdraw', 'deposit', 'transfer']) },
    });
  }

  async getPipelineStatus(pipelineId: number): Promise<LiquidityManagementPipelineStatus> {
    const pipeline = await this.pipelineRepo.findOneBy({ id: pipelineId });

    if (!pipeline) throw new NotFoundException(`No liquidity management pipeline found for id ${pipelineId}`);

    return pipeline.status;
  }

  //*** HELPER METHODS ***//

  async startNewPipelines(): Promise<boolean> {
    const newPipelines = await this.pipelineRepo.findBy({ status: LiquidityManagementPipelineStatus.CREATED });

    this.logNewPipelines(newPipelines);

    for (const pipeline of newPipelines) {
      try {
        pipeline.start();
        await this.pipelineRepo.save(pipeline);
      } catch (e) {
        this.logger.error(`Error in starting new liquidity pipeline ${pipeline.id}:`, e);
        continue;
      }
    }

    return newPipelines.length > 0;
  }

  private async checkRunningPipelines(): Promise<boolean> {
    const runningPipelines = await this.pipelineRepo.find({
      where: { status: LiquidityManagementPipelineStatus.IN_PROGRESS },
      relations: { currentAction: { onSuccess: true, onFail: true } },
    });
    let anyChanged = false;

    for (const pipeline of runningPipelines) {
      try {
        const lastOrder = await this.orderRepo.findOne({
          where: { pipeline: { id: pipeline.id } },
          order: { id: 'DESC' },
        });

        // check running order
        if (lastOrder) {
          if (
            lastOrder.status === LiquidityManagementOrderStatus.COMPLETE ||
            lastOrder.status === LiquidityManagementOrderStatus.FAILED ||
            lastOrder.status === LiquidityManagementOrderStatus.NOT_PROCESSABLE
          ) {
            pipeline.continue(lastOrder.status);
            await this.pipelineRepo.save(pipeline);
            anyChanged = true;

            if (pipeline.status === LiquidityManagementPipelineStatus.COMPLETE) {
              await this.handlePipelineCompletion(pipeline);
              continue;
            }

            if (
              [LiquidityManagementPipelineStatus.FAILED, LiquidityManagementPipelineStatus.STOPPED].includes(
                pipeline.status,
              )
            ) {
              await this.handlePipelineFail(pipeline, lastOrder);
              continue;
            }
          } else {
            // order still running
            continue;
          }
        }

        // start new order
        this.logger.verbose(
          `Continue with next liquidity management pipeline action. Action ID: ${pipeline.currentAction.id}`,
        );

        await this.placeLiquidityOrder(pipeline, lastOrder);
        anyChanged = true;
      } catch (e) {
        this.logger.error(`Error in checking running liquidity pipeline ${pipeline.id}:`, e);
        continue;
      }
    }

    return anyChanged;
  }

  private async placeLiquidityOrder(
    pipeline: LiquidityManagementPipeline,
    previousOrder: LiquidityManagementOrder | null,
  ): Promise<void> {
    const { minAmount, maxAmount, currentAction } = pipeline;
    const order = LiquidityManagementOrder.create(minAmount, maxAmount, pipeline, currentAction, previousOrder?.id);

    await this.orderRepo.save(order);
  }

  private async startNewOrders(): Promise<boolean> {
    const newOrders = await this.orderRepo.findBy({ status: LiquidityManagementOrderStatus.CREATED });
    let anyChanged = false;

    for (const order of newOrders) {
      // A CREATED order that already carries a reference means a previous pass reached the send boundary and
      // never recorded the result — the process died between transmitting and saving. Re-sending it is the
      // one thing we must not do, so it goes straight into quarantine to be reconciled.
      if (order.correlationId) {
        order.uncertain(
          new OrderOutcomeUnknownException(
            `Reference ${order.correlationId} was reserved but the result was never recorded — the request may have been sent`,
          ),
        );
        await this.orderRepo.save(order);
        await this.reportUncertainOrder(order);
        anyChanged = true;
        continue;
      }

      try {
        await this.executeOrder(order);
        anyChanged = true;
      } catch (e) {
        if (e instanceof OrderNotNecessaryException) {
          order.complete();
          await this.orderRepo.save(order);
        } else if (e instanceof OrderNotProcessableException) {
          order.notProcessable(e);
          await this.orderRepo.save(order);
        } else if (e instanceof OrderFailedException) {
          order.fail(e);
          await this.orderRepo.save(order);
        } else if (e instanceof OrderOutcomeUnknownException || order.correlationId) {
          // Either the integration declared the outcome unknown, or a reference was reserved — meaning the
          // send boundary was crossed and we cannot prove the request did not reach the venue. Quarantine
          // rather than fail: failing pauses the rule, and the rule auto-reactivates, which would repeat a
          // request that may already have executed.
          const cause = e instanceof OrderOutcomeUnknownException ? e : new OrderOutcomeUnknownException(e.message);
          order.uncertain(cause);
          await this.orderRepo.save(order);
          await this.reportUncertainOrder(order);
        } else {
          // No reference was ever reserved, so nothing can have been transmitted — this is an ordinary
          // failure. Quarantining it would strand configuration and factory errors in a state only a human
          // can clear, for a request that provably never happened.
          order.fail(new OrderFailedException(e.message));
          await this.orderRepo.save(order);
        }

        // every branch above persists a new status, so the order leaves the CREATED set either way — this is
        // what keeps the caller's `while (hasChanges)` loop from spinning on an order it cannot advance
        anyChanged = true;

        this.logger.info(`Error in starting new liquidity order ${order.id}:`, e);
      }
    }

    return anyChanged;
  }

  private async executeOrder(order: LiquidityManagementOrder): Promise<void> {
    const actionIntegration = this.actionIntegrationFactory.getIntegration(order.action);

    // Claim the venue-side reference before the request goes out. Integrations that can pin their own
    // reference (Scrypt's ClOrdID) become traceable after an un-acknowledged send; the persisted id is also
    // what makes a crash between send and save recoverable instead of orphaning a live venue order.
    const reservedCorrelationId = actionIntegration.reserveCorrelationId?.(order);
    if (reservedCorrelationId) {
      order.reserveCorrelationId(reservedCorrelationId);
      await this.orderRepo.save(order);
    }

    const correlationId = await actionIntegration.executeOrder(order);
    order.inProgress(correlationId);

    await this.orderRepo.save(order);
  }

  /**
   * Resolve orders quarantined as UNCERTAIN by asking the venue what actually happened.
   *
   * This only ever observes — it must not re-send anything. An order leaves quarantine when the venue
   * either confirms it knows the reference (back to IN_PROGRESS, the normal completion check takes over) or
   * demonstrably does not (FAILED, so the rule may plan anew from a fresh balance). Anything inconclusive
   * stays put: an order nobody can account for is safer parked than retried.
   */
  private async resolveUncertainOrders(): Promise<boolean> {
    // First: anything this process observed and could not write. Retried before new lookups, because an
    // order the venue has confirmed sitting in a terminal state is the one thing here that cannot wait.
    for (const unapplied of [...this.unappliedObservations.values()]) await this.blockConfirmedOrder(unapplied);

    const orders = await this.orderRepo.findBy({ status: LiquidityManagementOrderStatus.UNCERTAIN });
    let anyChanged = false;

    // an order that has left quarantine has no cooldown to keep
    const quarantinedIds = new Set(orders.map((order) => order.id));
    for (const id of this.uncertainResolveAttempts.keys())
      if (!quarantinedIds.has(id)) this.uncertainResolveAttempts.delete(id);

    for (const order of orders) {
      // Somebody has already judged this one never sent; the venue's answer is what puts that into effect.
      const releasePending = Boolean(order.notSentRecheckDue);

      // Not re-asked on every pass: the interval grows with the order's age, because the value of asking
      // decays with it — a fresh order's venue answer can still change, an eight-hour-old one's cannot. A
      // pending release bypasses the wait entirely: a manual release must complete on the next tick, and
      // its own venue-wait runs on its own clock.
      if (!releasePending) {
        const ageMs = Date.now() - order.created.getTime();
        const intervalMs = Math.min(
          Math.max(ageMs / 10, UNCERTAIN_RESOLVE_MIN_INTERVAL_MS),
          UNCERTAIN_RESOLVE_MAX_INTERVAL_MS,
        );

        const lastAttemptEnd = this.uncertainResolveAttempts.get(order.id);
        if (lastAttemptEnd && Date.now() - lastAttemptEnd.getTime() < intervalMs) continue;
      }

      try {
        // Null when the action's system or command is no longer registered at all — an order can outlive the
        // adapter that made it, and dereferencing that would throw here on every pass, forever.
        const actionIntegration = this.actionIntegrationFactory.getIntegration(order.action);

        if (!actionIntegration?.resolveUncertainOrder) {
          // The one exception to "a release waits for the venue": there is no lookup for this order at all,
          // so the answer it would wait for can never come, and waiting would quarantine it for good. The
          // operator's judgement is all there is, which is why the assertion behind it is required.
          if (releasePending && (await this.completeNotSentRelease(order, 'no integration can look it up')))
            anyChanged = true;
          // Deliberately no automatic abandon here. Without an integration the venue is never asked, so the
          // only thing left would be the clock — and the safety of abandoning rests on the rule replanning
          // from a balance that reflects an execution which did happen. That holds for an exchange read live
          // at plan time; it does not hold for a chain balance that omits unconfirmed transactions, nor for a
          // bank balance carried over from the last imported batch. Abandoning on the clock alone would be
          // guessing with the one class of order nothing here can observe.
          continue;
        }

        let resolution: UncertainOrderResolution;
        try {
          resolution = await actionIntegration.resolveUncertainOrder(order);
        } finally {
          // Stamped when the lookup finishes, whatever it returned or threw. A dead connection is exactly
          // the regime the cooldown exists for — stamping only successes would re-ask a venue that cannot
          // answer on every pass, at full fetch cost each time.
          this.uncertainResolveAttempts.set(order.id, new Date());
        }

        if (resolution === UncertainOrderResolution.SENT) {
          if (await this.applyConfirmedObservation(order)) {
            anyChanged = true;
            this.logger.info(`Uncertain liquidity order ${order.id} resolved: venue confirmed it was sent`);
          }
        } else if (resolution === UncertainOrderResolution.NOT_SENT) {
          // Every reference came back refused — a verdict, not a judgement, so it needs no confirming.
          if (await this.completeNotSentRelease(order, 'the venue confirmed the request never arrived'))
            anyChanged = true;
        } else if (releasePending && resolution === UncertainOrderResolution.UNRESOLVED) {
          // The venue answered and has no record, which is not proof on its own — but somebody has already
          // checked independently and released the order on that basis. Two negatives, one of them from a
          // person who looked: that is what this release was waiting for.
          if (await this.completeNotSentRelease(order, 'the venue has no record of it either')) anyChanged = true;
        } else if (releasePending && order.releaseWaitedOutVenue()) {
          // Nobody has been able to ask this venue anything for long enough. Waiting more does not make an
          // answer likelier; it only keeps an order a person has verified by hand out of reach.
          if (await this.completeNotSentRelease(order, 'the venue could not be reached for long enough'))
            anyChanged = true;
        } else if (resolution === UncertainOrderResolution.UNRESOLVED && order.unresolvableTooLong()) {
          // The venue has been answering "no record" past the point this request could still be live, and no
          // operator has released the order. The
          // original design waited here indefinitely, which is only safe if somebody eventually looks — where
          // nobody does, the rule never runs again and the venue stops being served entirely. Abandoning is
          // the lesser failure, and it is safe for a reason that has nothing to do with this order: the rule
          // replans from the venue's current balance, so an execution that did happen is already reflected
          // there and sizes the replan down rather than duplicating it.
          if (await this.abandonUnresolvableOrder(order)) anyChanged = true;
        }
        // Otherwise — a venue that cannot be asked yet, or an inconclusive answer that has not yet run out
        // its clock — nothing changes and it keeps blocking.
      } catch (e) {
        // a failing lookup must never promote the order out of quarantine
        this.logger.error(`Error in resolving uncertain liquidity order ${order.id}:`, e);
      }
    }

    return anyChanged;
  }

  /**
   * Put a not-sent conclusion into effect: the order becomes an ordinary failure and its rule may plan anew.
   *
   * The evidence-based way out of quarantine downwards. Everything that reaches here has either a venue
   * verdict behind it, or a person who checked plus a venue that has no record — never a single judgement on
   * its own. The two exceptions are about liveness, not evidence: a venue nothing can ask, and one that has
   * answered nothing for long enough. Silence there stops vetoing the person who checked; it proves nothing.
   *
   * The other way out is {@link abandonUnresolvableOrder}, which rests on no evidence at all and exists only
   * so that an order nobody releases cannot block its rule forever.
   */
  private async completeNotSentRelease(order: LiquidityManagementOrder, because: string): Promise<boolean> {
    // The release this pass looked at, captured before the entity is mutated. Ending an order is the one
    // irreversible step here, so it may only be taken against exactly the release that was examined — never
    // against one written since, whose own confirmation is still outstanding.
    const examined = order.notSentRecheckDue ?? null;

    order.resolveAsNotSent(`${order.errorMessage} (released ${new Date().toISOString()}: ${because})`);

    if (!(await this.leaveQuarantine(order, examined))) return false;

    this.logger.info(`Uncertain liquidity order ${order.id} released as never sent: ${because}`);

    return true;
  }

  /**
   * Abandon an order the venue has never been able to account for, so its rule runs again.
   *
   * The second way out of quarantine downwards, and unlike {@link completeNotSentRelease} it rests on no
   * conclusion about the request at all — only on the clock. That is why the reason recorded says the venue
   * had no record rather than that nothing was sent: the row must not claim an observation nobody made.
   *
   * Logged as a warning, not an info. Nothing here is routine — an order reaching this point means the venue
   * lost track of a request for hours — and the entry is what makes that visible without an operator having
   * to be the mechanism that unblocks it.
   */
  private async abandonUnresolvableOrder(order: LiquidityManagementOrder): Promise<boolean> {
    const because = 'the venue has had no record of it past the point its request could still be live';

    // Captured before the entity is mutated, exactly as completeNotSentRelease does. An operator may have
    // written a release between this pass's read and this write; that release carries an audited reason and
    // is owed one more venue answer before anything ends the order. Without narrowing on it, this write —
    // the one resting on no evidence at all — would silently overwrite the one resting on a person.
    const examined = order.notSentRecheckDue ?? null;

    order.abandonAsUnresolvable(`${order.errorMessage} (abandoned ${new Date().toISOString()}: ${because})`);

    if (!(await this.leaveQuarantine(order, examined))) return false;

    this.logger.warn(`Uncertain liquidity order ${order.id} abandoned: ${because}`);

    return true;
  }

  /**
   * Record that the venue holds this order — and make sure that fact lands somewhere durable.
   *
   * Both releases are conditional on the state they expect, so either can miss, and either can fail. What
   * must never follow from that is a confirmed order sitting in a state its rule reads as finished: an alert
   * is acted on at human speed, a rule reactivates in minutes. So anything short of a clean release puts the
   * order back into quarantine, which is the state this subdomain already treats as "in flight, outcome
   * open" — no rule plans against it, and the next reconciliation pass simply tries again.
   *
   * Returns whether the order was released; a re-quarantined one has not been.
   */
  private async applyConfirmedObservation(order: LiquidityManagementOrder): Promise<boolean> {
    // First, and as its own smallest possible write: put the order where nothing acts on it. That covers
    // both a pending release, which could otherwise end it on the next inconclusive lookup, and a release
    // that has already ended it — repairing that here rather than afterwards is what stops this process
    // from being the only thing standing between a live venue order and a second request.
    await this.secureConfirmedOrder(order);

    order.resolveAsSent();

    try {
      if (await this.leaveQuarantine(order)) return true;
    } catch (e) {
      this.logger.error(`Could not record the venue observation for liquidity order ${order.id}:`, e);
    }

    await this.blockConfirmedOrder(order);

    return false;
  }

  /**
   * Make an order the venue has confirmed safe in one statement, before anything else can fail.
   *
   * Quarantine is the state nothing acts on, so this both strips a pending release of its power to end the
   * order and puts one that has already been ended back. Everything else about applying an observation can
   * be retried; this cannot wait for a retry, because until it lands the only thing keeping a confirmed
   * order from being treated as finished business is this process staying alive.
   *
   * Deliberately the narrowest write here: two columns, no appended text, no read it depends on. The reason
   * why follows separately, and if that never lands the order is at least still blocking.
   */
  private async secureConfirmedOrder(order: LiquidityManagementOrder): Promise<void> {
    await this.orderRepo
      .update(
        {
          id: order.id,
          status: In([
            LiquidityManagementOrderStatus.UNCERTAIN,
            LiquidityManagementOrderStatus.FAILED,
            LiquidityManagementOrderStatus.NOT_PROCESSABLE,
          ]),
        },
        { status: LiquidityManagementOrderStatus.UNCERTAIN, notSentRecheckDue: null },
      )
      .catch((e) => this.logger.error(`Could not secure confirmed liquidity order ${order.id}:`, e));
  }

  /**
   * Put an order the venue has confirmed back where nothing can act on it, and say so.
   *
   * Left alone only where the outcome is already safe: in progress or complete means somebody released it
   * correctly first, still quarantined means it never stopped blocking and the next pass will retry. Every
   * other state — including one this pass could not even read — is reported, because it is the case where a
   * live venue order was about to be treated as finished business.
   */
  private async blockConfirmedOrder(order: LiquidityManagementOrder): Promise<void> {
    const current = await this.orderRepo.findOneBy({ id: order.id }).catch(() => null);

    // Already safe: in progress or complete means another path released it correctly. Still quarantined
    // counts too, but only with no release pending on it — a quarantined order somebody has released is one
    // inconclusive lookup away from being ended, which is precisely what the observation contradicts.
    const settled = [LiquidityManagementOrderStatus.IN_PROGRESS, LiquidityManagementOrderStatus.COMPLETE];
    const safe =
      current &&
      (settled.includes(current.status) ||
        (current.status === LiquidityManagementOrderStatus.UNCERTAIN && !current.notSentRecheckDue));

    if (safe) {
      this.unappliedObservations.delete(order.id);
      return;
    }

    const message =
      `Liquidity order ${order.id}: the venue confirms reference ${order.correlationId} exists, but that could ` +
      `not be recorded as usual. It is held as uncertain — treat it as live at the venue and resolve it by ` +
      `hand; no rule may plan against these funds until somebody has.`;

    const blocked = await this.orderRepo
      .update(
        // Guarded on the exact reason just read: between that read and this write another path can have
        // replaced it, and appending to the older copy would erase whatever it now says.
        {
          id: order.id,
          status: In([LiquidityManagementOrderStatus.FAILED, LiquidityManagementOrderStatus.NOT_PROCESSABLE]),
          ...(current ? { errorMessage: current.errorMessage } : {}),
        },
        // Append to the reason already on the row, and where it could not be read, change only the status:
        // whatever it says may be the operator account and verification reference behind the resolution
        // being overruled, and that has to survive.
        current
          ? {
              status: LiquidityManagementOrderStatus.UNCERTAIN,
              errorMessage: [current.errorMessage, message].filter((part) => part).join(' — '),
              notSentRecheckDue: null,
            }
          : { status: LiquidityManagementOrderStatus.UNCERTAIN },
      )
      .then((result) => Boolean(result.affected))
      .catch(() => false);

    // Kept for the next pass if it did not land. Dropping it here is what would let a confirmed order stay
    // terminal on the strength of one failed statement.
    if (blocked) this.unappliedObservations.delete(order.id);
    else this.unappliedObservations.set(order.id, order);

    this.logger.error(message);

    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      context: MailContext.LIQUIDITY_MANAGEMENT,
      correlationId: `lm-observation-unapplied-${order.id}`,
      options: { debounce: 3600000 },
      input: { subject: 'Liquidity management order CONFIRMED BUT NOT RECORDED', errors: [message] },
    });
  }

  /**
   * Write a resolved order back, but only if it is still quarantined.
   *
   * Automatic reconciliation and an operator can be looking at the same order at the same time; an
   * unconditional save would let whoever finishes last win. Losing that race the wrong way would release a
   * rule for an order the venue had just confirmed as live, which is the double execution this all exists to
   * prevent — so the status is part of the WHERE clause and a lost race is simply skipped.
   */
  private async leaveQuarantine(order: LiquidityManagementOrder, expectedRecheckDue?: Date | null): Promise<boolean> {
    const result = await this.orderRepo.update(
      {
        id: order.id,
        status: LiquidityManagementOrderStatus.UNCERTAIN,
        // narrowed by the caller when the outcome depends on WHICH pending release was examined
        ...(expectedRecheckDue !== undefined ? { notSentRecheckDue: expectedRecheckDue } : {}),
      },
      {
        status: order.status,
        errorMessage: order.errorMessage,
        correlationId: order.correlationId,
        previousCorrelationIds: order.previousCorrelationIds,
        // carries the pending-release marker: set when somebody releases the order, cleared once the venue
        // has answered, and written here because this is where either becomes durable
        notSentRecheckDue: order.notSentRecheckDue ?? null,
      },
    );

    if (!result.affected) {
      this.logger.info(`Uncertain liquidity order ${order.id} was already resolved elsewhere, skipping`);
      return false;
    }

    // A landed write ends the quarantine episode, and the cooldown stamp's lifetime is exactly one episode:
    // an order quarantined anew must get its first lookup immediately, not inherit an old wait.
    this.uncertainResolveAttempts.delete(order.id);

    return true;
  }

  private async reportUncertainOrder(order: LiquidityManagementOrder): Promise<void> {
    const message =
      `Liquidity order ${order.id} (action ${order.action.id}, ${order.action.system}/${order.action.command}) ` +
      `has an unknown outcome: ${order.errorMessage}. Reference: ${order.correlationId ?? 'none reserved'}. ` +
      `The order is quarantined and will NOT be retried automatically — it is resolved against the venue.`;

    this.logger.error(message);

    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      context: MailContext.LIQUIDITY_MANAGEMENT,
      // pinned per order so repeated reports collapse instead of one mail per pass; debounce rather than
      // suppressRecurring, so a still-unresolved order keeps reminding us once an hour
      correlationId: `lm-order-uncertain-${order.id}`,
      options: { debounce: 3600000 },
      input: {
        subject: 'Liquidity management order outcome UNKNOWN',
        errors: [message],
      },
    });
  }

  /**
   * Release a quarantined order by hand, after somebody checked the venue directly.
   *
   * Reconciliation can only ever confirm that a reference exists; it never concludes the opposite, because
   * no venue reply proves "this was never accepted". Without this path a genuinely unsent request would
   * block its rule forever. Guarded like the payout subdomain's retry: the caller must assert the check and
   * name where it happened, and the assertion is recorded on the order.
   */
  async resolveUncertainOrderManually(
    orderId: number,
    dto: ResolveUncertainOrderDto,
    resolvedBy: number,
  ): Promise<void> {
    // Re-asserted here, not only at the edge: this is the one call that can release a possibly-executed
    // request, so the claim behind it must hold at the point where it takes effect.
    if (dto.noExecutionVerified !== true)
      throw new BadRequestException('noExecutionVerified must be true — an unverified order stays quarantined');

    const verificationReference = dto.verificationReference?.trim();
    if (!verificationReference)
      throw new BadRequestException('verificationReference must name where the venue was checked');

    const order = await this.orderRepo.findOneBy({ id: orderId });
    if (!order) throw new NotFoundException(`No liquidity management order found for id ${orderId}`);

    if (order.status !== LiquidityManagementOrderStatus.UNCERTAIN)
      throw new BadRequestException(
        `Liquidity management order ${orderId} is ${order.status}, only an uncertain order can be resolved manually`,
      );

    // Ask the venue one more time, right here. A compare-and-set alone only decides who writes first, and
    // "first" is not the same as "right": an operator releasing the order in the same moment reconciliation
    // confirms it is live would win the write and release the rule against a live position. A positive
    // observation therefore outranks the operator's judgement.
    //
    // A lookup that cannot be performed does not refuse the request outright — but it does not put it into
    // effect either. The order stays quarantined until reconciliation has had one answer, so a release can
    // never end an order while a confirmation of it is still in flight.
    const actionIntegration = this.actionIntegrationFactory.getIntegration(order.action);
    if (actionIntegration?.resolveUncertainOrder) {
      const resolution = await actionIntegration.resolveUncertainOrder(order);

      if (resolution === UncertainOrderResolution.SENT) {
        // Record the observation before refusing. Merely throwing would leave the row quarantined, so a
        // later attempt — made while the venue happens to be unreachable — could still release it and undo
        // what we just saw. Once observed live, the order is no longer a candidate for manual release at all.
        // Same path as automatic reconciliation, including what happens when that write does not land.
        const released = await this.applyConfirmedObservation(order);

        throw new ConflictException(
          `Liquidity management order ${orderId} cannot be released: the venue confirms the request exists. ` +
            (released
              ? 'It has been returned to in progress and the normal completion check now tracks it.'
              : 'It could not be returned to in progress and is held as uncertain — it has been reported.'),
        );
      }
    }

    order.requestNotSentRelease(
      `${order.errorMessage} (released by account ${resolvedBy} at ${new Date().toISOString()}: ` +
        `venue checked, no execution found — ${verificationReference})`,
    );

    if (!(await this.leaveQuarantine(order)))
      throw new ConflictException(
        `Liquidity management order ${orderId} was resolved elsewhere while this request was in flight`,
      );

    // only after the write actually landed — a log line for a save that failed is worse than none
    this.logger.info(
      `Uncertain liquidity order ${orderId} manually resolved as not executed by account ${resolvedBy}, verified via ${verificationReference}`,
    );
  }

  private async checkRunningOrders(): Promise<boolean> {
    const runningOrders = await this.orderRepo.findBy({ status: LiquidityManagementOrderStatus.IN_PROGRESS });
    let anyChanged = false;

    for (const order of runningOrders) {
      try {
        const changed = await this.checkOrder(order);
        anyChanged = anyChanged || changed;
      } catch (e) {
        if (e instanceof OrderNotProcessableException) {
          order.notProcessable(e);
          await this.orderRepo.save(order);
          anyChanged = true;
          continue;
        }
        if (e instanceof OrderFailedException) {
          order.fail(e);
          await this.orderRepo.save(order);
          anyChanged = true;
          continue;
        }
        if (e instanceof OrderOutcomeUnknownException) {
          // The completion check can amend or restart an order, so it has a send boundary of its own. An
          // unconfirmed outcome here must quarantine rather than fail, for the same reason as on first send.
          order.uncertain(e);
          await this.orderRepo.save(order);
          await this.reportUncertainOrder(order);
          anyChanged = true;
          continue;
        }

        this.logger.error(`Error in checking running liquidity order ${order.id}:`, e);
      }
    }

    return anyChanged;
  }

  private async checkOrder(order: LiquidityManagementOrder): Promise<boolean> {
    const actionIntegration = this.actionIntegrationFactory.getIntegration(order.action);
    const isComplete = await actionIntegration.checkCompletion(order);

    if (isComplete) {
      order.complete();
    }

    await this.orderRepo.save(order);

    return isComplete;
  }

  private async handlePipelineCompletion(pipeline: LiquidityManagementPipeline): Promise<void> {
    const rule = pipeline.rule.reactivate();

    await this.ruleRepo.save(rule);

    // No mail on success. Over the week to 27.07.2026 this path produced 211 of 255 liquidity mails, none of
    // which carried information or asked for an action — and that volume is what made the mails that DO
    // matter (see reportUncertainOrder) unreadable. The completion stays in the log.
    this.logger.verbose(this.generateSuccessMessage(pipeline));
  }

  private async handlePipelineFail(
    pipeline: LiquidityManagementPipeline,
    order: LiquidityManagementOrder,
  ): Promise<void> {
    const rule = pipeline.rule.pause();

    // The rule is now paused; clear its activation-debounce timer so a later reactivation re-debounces.
    this.liquidityManagementService.resetActivation(rule.id);

    await this.ruleRepo.save(rule);

    const [errorMessage, mailRequest] = this.generateFailMessage(pipeline, order);

    this.logger.info(errorMessage);

    if (rule.sendNotifications) await this.notificationService.sendMail(mailRequest);
  }

  /**
   * Stable short key for "same cause", used to scope alert debouncing. Digits are stripped so that amounts,
   * ids and balances in the message do not make every repeat of one recurring problem look like a new one.
   */
  private causeKey(errorMessage?: string): string {
    const normalized = (errorMessage ?? 'unknown').toLowerCase().replace(/\d+/g, '#');

    return Util.createHash(normalized).slice(0, 12);
  }

  private generateSuccessMessage(pipeline: LiquidityManagementPipeline): string {
    const { id, type, maxAmount, rule } = pipeline;

    return `${type} pipeline for max. ${maxAmount} ${rule.targetName} (rule ${rule.id}) completed. Pipeline ID: ${id}`;
  }

  private generateFailMessage(
    pipeline: LiquidityManagementPipeline,
    order: LiquidityManagementOrder,
  ): [string, MailRequest] {
    const { id, type, maxAmount, rule } = pipeline;
    const errorMessage = `${type} pipeline for max. ${maxAmount} ${rule.targetName} (rule ${
      rule.id
    }) ${pipeline.status.toLowerCase()}. Pipeline ID: ${id}`;

    const mailRequest: MailRequest = {
      type: MailType.ERROR_MONITORING,
      context: MailContext.LIQUIDITY_MANAGEMENT,
      // Pinned per rule and debounced: a single incident retries every few minutes, and each attempt used to
      // mail. On 20.07.2026 two rules produced 18 mails in two hours for one underlying problem. Debounce
      // rather than suppressRecurring, so a rule that keeps failing keeps reminding us once an hour instead
      // of going quiet forever after the first mail.
      // Keyed by rule AND cause. Suppression compares only correlationId and context, never the body, so a
      // rule-only key would swallow a genuinely different failure of the same rule inside the window.
      // Keying by pipeline would defeat the purpose instead — every retry is a new pipeline, which is how
      // one incident produced 18 mails in two hours.
      correlationId: `lm-pipeline-fail-${rule.id}-${this.causeKey(order.errorMessage)}`,
      options: { debounce: 3600000 },
      input: {
        subject: 'Liquidity management pipeline FAIL',
        errors: [
          errorMessage,
          pipeline.status === LiquidityManagementPipelineStatus.FAILED
            ? `Error: ${order.errorMessage}`
            : 'Maximum order count reached',
        ],
      },
    };

    return [errorMessage, mailRequest];
  }

  private logNewPipelines(newPipelines: LiquidityManagementPipeline[]): void {
    if (newPipelines.length > 0)
      this.logger.verbose(
        `Starting ${newPipelines.length} new liquidity management pipeline(s). Rules: ${newPipelines.map(
          (p) => p.rule.id,
        )}`,
      );
  }
}
