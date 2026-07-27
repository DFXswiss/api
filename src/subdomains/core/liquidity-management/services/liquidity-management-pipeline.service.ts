import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailRequest } from 'src/subdomains/supporting/notification/interfaces';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { In, IsNull, Not } from 'typeorm';
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
 * Stamped onto every failure that comes from concluding a request was never sent — as opposed to one the
 * venue actually ended. Only a failure carrying this can be taken back by a later positive observation.
 */
const UNSENT_RESOLUTION_MARKER = '[resolved-as-not-sent]';

@Injectable()
export class LiquidityManagementPipelineService {
  private readonly logger = new DfxLogger(LiquidityManagementPipelineService);

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
    const orders = await this.orderRepo.findBy([
      { status: LiquidityManagementOrderStatus.UNCERTAIN },
      // Failed by a not-sent resolution and not looked at since. The pass that wrote it may have been racing
      // one that had just watched the venue confirm the same order, so an observation whose writes did not
      // land is still applied here. Exactly one further look, marked and released by `notSentRecheckDue`:
      // an equality predicate on an indexed column, not a wildcard match over every failure ever recorded.
      { status: LiquidityManagementOrderStatus.FAILED, notSentRecheckDue: Not(IsNull()) },
    ]);
    let anyChanged = false;

    for (const order of orders) {
      const wasResolvedAsNotSent = order.status === LiquidityManagementOrderStatus.FAILED;

      try {
        const actionIntegration = this.actionIntegrationFactory.getIntegration(order.action);

        if (!actionIntegration.resolveUncertainOrder) {
          // Nothing can look this order up, so the marked recheck can never happen. Left standing it would
          // have every pass select the row and skip it again, for the rest of the row's life.
          if (wasResolvedAsNotSent) await this.releaseNegativeResolution(order);
          continue;
        }

        const resolution = await actionIntegration.resolveUncertainOrder(order);

        // The look this row was kept for has now happened and found nothing to overrule the resolution
        // with. Releasing it here rather than on a timer is what keeps the venue from being asked about
        // settled failures every ten seconds for the rest of their existence.
        if (wasResolvedAsNotSent && resolution !== UncertainOrderResolution.SENT)
          await this.releaseNegativeResolution(order);

        if (resolution === UncertainOrderResolution.SENT) {
          if (await this.applyConfirmedObservation(order)) {
            anyChanged = true;
            this.logger.info(`Uncertain liquidity order ${order.id} resolved: venue confirmed it was sent`);
          }
        } else if (
          resolution === UncertainOrderResolution.NOT_SENT &&
          order.status === LiquidityManagementOrderStatus.UNCERTAIN
        ) {
          order.resolveAsNotSent(
            `${order.errorMessage} (venue confirmed the request never arrived, ${new Date().toISOString()}) ` +
              UNSENT_RESOLUTION_MARKER,
          );
          if (await this.leaveQuarantine(order)) {
            anyChanged = true;
            this.logger.info(`Uncertain liquidity order ${order.id} resolved: venue never received it`);
          }
        }
      } catch (e) {
        // a failing lookup must never promote the order out of quarantine
        this.logger.error(`Error in resolving uncertain liquidity order ${order.id}:`, e);
      }
    }

    return anyChanged;
  }

  /** Note that a not-sent resolution has had its one re-examination, so it stops being reconciled. */
  private async releaseNegativeResolution(order: LiquidityManagementOrder): Promise<void> {
    await this.orderRepo.update(
      // Guarded on the exact marker this pass looked at. A newer resolution written in between owes a look
      // of its own, and clearing ITS marker would drop the obligation this whole mechanism exists to keep.
      { id: order.id, status: LiquidityManagementOrderStatus.FAILED, notSentRecheckDue: order.notSentRecheckDue },
      { notSentRecheckDue: null },
    );
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
    order.resolveAsSent();

    try {
      if (await this.leaveQuarantine(order)) return true;
      if (await this.reclaimFromNegativeResolution(order)) return true;
    } catch (e) {
      this.logger.error(`Could not record the venue observation for liquidity order ${order.id}:`, e);
    }

    await this.blockConfirmedOrder(order);

    return false;
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

    // Already safe: in progress or complete means another path released it correctly, still uncertain means
    // it never stopped blocking and the next pass will try again. Anything else — including a state that
    // could not be read — is the case this exists for.
    const safe = [
      LiquidityManagementOrderStatus.IN_PROGRESS,
      LiquidityManagementOrderStatus.COMPLETE,
      LiquidityManagementOrderStatus.UNCERTAIN,
    ];
    if (current && safe.includes(current.status)) return;

    const message =
      `Liquidity order ${order.id}: the venue confirms reference ${order.correlationId} exists, but that could ` +
      `not be recorded as usual. It is held as uncertain — treat it as live at the venue and resolve it by ` +
      `hand; no rule may plan against these funds until somebody has.`;

    await this.orderRepo
      .update(
        // Same exact-value guard as the reclaim where the reason could be read: appending to a copy that a
        // newer resolution has already replaced would erase it.
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
      .catch(() => undefined);

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
  private async leaveQuarantine(order: LiquidityManagementOrder): Promise<boolean> {
    const result = await this.orderRepo.update(
      { id: order.id, status: LiquidityManagementOrderStatus.UNCERTAIN },
      {
        status: order.status,
        errorMessage: order.errorMessage,
        correlationId: order.correlationId,
        previousCorrelationIds: order.previousCorrelationIds,
        // carries the resolution's own marker: set by a not-sent resolution so reconciliation looks once
        // more, cleared by a positive one, and written here because this is where either becomes durable
        notSentRecheckDue: order.notSentRecheckDue ?? null,
      },
    );

    if (!result.affected) {
      this.logger.info(`Uncertain liquidity order ${order.id} was already resolved elsewhere, skipping`);
      return false;
    }

    return true;
  }

  /**
   * Undo a negative resolution that beat a positive observation to the write.
   *
   * The compare-and-set only decides who writes first, and first is not the same as right. If somebody
   * released this order as not executed while we were busy watching the venue confirm it, the order is now
   * failed — which lets its rule plan again against a position that is still live. An observation outranks a
   * judgement, so it is taken back, and loudly.
   */
  private async reclaimFromNegativeResolution(order: LiquidityManagementOrder): Promise<boolean> {
    // Read what the row says NOW. The copy this pass started with predates the resolution being overruled,
    // and writing it back would erase the account that released the order and the reference they checked —
    // the record of the very judgement this is overruling, and the first thing anybody reviewing it needs.
    const current = await this.orderRepo.findOneBy({ id: order.id });
    if (current?.status !== LiquidityManagementOrderStatus.FAILED) return false;

    // Only failures written BY a not-sent resolution. Taking back one that ended for an entirely unrelated
    // reason would resurrect an order the venue really did finish — the reclaim overrules a judgement, never
    // the venue. Checked on the value just read, which is also the value the write below is guarded on.
    if (!current.errorMessage?.includes(UNSENT_RESOLUTION_MARKER)) return false;

    const result = await this.orderRepo.update(
      // Narrowed to failures written BY a not-sent resolution. Matching any failed row would resurrect an
      // order that ended for an entirely unrelated reason — the reclaim exists to overrule a judgement, not
      // to overrule the venue.
      // Narrowed to the exact reason just read. Between the read and this write another resolution can have
      // replaced it, and appending to the older text would erase the newer operator and reference — the
      // audit trail this reclaim exists to preserve, not to overwrite.
      { id: order.id, status: LiquidityManagementOrderStatus.FAILED, errorMessage: current.errorMessage },
      {
        status: LiquidityManagementOrderStatus.IN_PROGRESS,
        errorMessage: `${current.errorMessage} (reinstated: the venue confirmed this request exists after it had been resolved as not executed)`,
        correlationId: order.correlationId,
        previousCorrelationIds: order.previousCorrelationIds,
        notSentRecheckDue: null,
      },
    );

    if (!result.affected) return false;

    this.logger.error(
      `Liquidity order ${order.id} had been resolved as not executed, but the venue confirms it exists — reinstated as in progress`,
    );

    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      context: MailContext.LIQUIDITY_MANAGEMENT,
      correlationId: `lm-order-reinstated-${order.id}`,
      options: { debounce: 3600000 },
      input: {
        subject: 'Liquidity management order REINSTATED',
        errors: [
          `Order ${order.id} was resolved as not executed, but the venue confirms reference ${order.correlationId} exists. ` +
            `It has been put back to in progress. Whoever released it should be told that the check missed it.`,
        ],
      },
    });

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
    // A lookup that cannot be performed does not block the release. The operator has asserted an independent
    // check, and a reference the venue can no longer be asked about must not become an order nobody can ever
    // clear.
    const actionIntegration = this.actionIntegrationFactory.getIntegration(order.action);
    if (actionIntegration.resolveUncertainOrder) {
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

    order.resolveAsNotSent(
      `${order.errorMessage} (manually resolved by account ${resolvedBy} at ${new Date().toISOString()}: ` +
        `venue checked, no execution found — ${verificationReference}) ${UNSENT_RESOLUTION_MARKER}`,
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
