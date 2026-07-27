import { Injectable, NotFoundException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailRequest } from 'src/subdomains/supporting/notification/interfaces';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { In } from 'typeorm';
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
      // A quarantined transfer is the definition of pending: the funds may already have left and the
      // financial log has to keep counting them, otherwise the equity snapshot loses exactly the amount
      // whose whereabouts are in question.
      status: In([LiquidityManagementOrderStatus.IN_PROGRESS, LiquidityManagementOrderStatus.UNCERTAIN]),
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
        } else {
          // Unknown outcome, either declared by the integration or because the error escaped classification
          // altogether. Both mean the same thing: we cannot prove the request did not reach the venue, so the
          // order is quarantined instead of failed — a failed order pauses its rule, and the rule
          // auto-reactivates, which would repeat a request that may already have executed.
          const cause = e instanceof OrderOutcomeUnknownException ? e : new OrderOutcomeUnknownException(e.message);
          order.uncertain(cause);
          await this.orderRepo.save(order);
          await this.reportUncertainOrder(order);
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
    const uncertainOrders = await this.orderRepo.findBy({ status: LiquidityManagementOrderStatus.UNCERTAIN });
    let anyChanged = false;

    for (const order of uncertainOrders) {
      try {
        const actionIntegration = this.actionIntegrationFactory.getIntegration(order.action);
        if (!actionIntegration.resolveUncertainOrder) continue;

        const resolution = await actionIntegration.resolveUncertainOrder(order);

        if (resolution === UncertainOrderResolution.SENT) {
          order.resolveAsSent();
          await this.orderRepo.save(order);
          anyChanged = true;
          this.logger.info(`Uncertain liquidity order ${order.id} resolved: venue confirmed it was sent`);
        } else if (resolution === UncertainOrderResolution.NOT_SENT) {
          order.resolveAsNotSent(`${order.errorMessage} (venue confirmed the request never arrived)`);
          await this.orderRepo.save(order);
          anyChanged = true;
          this.logger.info(`Uncertain liquidity order ${order.id} resolved: venue never received it`);
        }
      } catch (e) {
        // a failing lookup must never promote the order out of quarantine
        this.logger.error(`Error in resolving uncertain liquidity order ${order.id}:`, e);
      }
    }

    return anyChanged;
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
