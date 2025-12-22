import { Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Subscription } from 'rxjs';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailRequest } from 'src/subdomains/supporting/notification/interfaces';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { In } from 'typeorm';
import { LiquidityManagementOrder } from '../entities/liquidity-management-order.entity';
import { LiquidityManagementPipeline } from '../entities/liquidity-management-pipeline.entity';
import { LiquidityManagementOrderStatus, LiquidityManagementPipelineStatus } from '../enums';
import { OrderFailedException } from '../exceptions/order-failed.exception';
import { OrderNotNecessaryException } from '../exceptions/order-not-necessary.exception';
import { OrderNotProcessableException } from '../exceptions/order-not-processable.exception';
import { LiquidityActionIntegrationFactory } from '../factories/liquidity-action-integration.factory';
import { LiquidityManagementOrderRepository } from '../repositories/liquidity-management-order.repository';
import { LiquidityManagementPipelineRepository } from '../repositories/liquidity-management-pipeline.repository';
import { LiquidityManagementRuleRepository } from '../repositories/liquidity-management-rule.repository';
import { OrderCompletionEvent, OrderCompletionService } from './order-completion.service';

@Injectable()
export class LiquidityManagementPipelineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new DfxLogger(LiquidityManagementPipelineService);

  private orderCompletionSubscription: Subscription;

  constructor(
    private readonly ruleRepo: LiquidityManagementRuleRepository,
    private readonly orderRepo: LiquidityManagementOrderRepository,
    private readonly pipelineRepo: LiquidityManagementPipelineRepository,
    private readonly actionIntegrationFactory: LiquidityActionIntegrationFactory,
    private readonly notificationService: NotificationService,
    private readonly orderCompletionService: OrderCompletionService,
  ) {}

  // Subscribe to order completion events for immediate pipeline continuation
  onModuleInit(): void {
    this.orderCompletionSubscription = this.orderCompletionService.orderCompleted$.subscribe((event) =>
      this.onOrderCompleted(event),
    );
  }

  // Cleanup subscription to prevent memory leaks
  onModuleDestroy(): void {
    this.orderCompletionSubscription?.unsubscribe();
  }

  //*** JOBS ***//

  /**
   * Main cron job - now serves as fallback since order completion is event-driven.
   * The primary flow is: OrderCompletionService detects completion → emits event → onOrderCompleted() continues pipeline
   */
  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.LIQUIDITY_MANAGEMENT, timeout: 1800 })
  async processPipelines(): Promise<void> {
    // Note: checkRunningOrders is now handled by OrderCompletionService
    await this.startNewPipelines();

    let hasWaitingOrders = true;
    for (let i = 0; i < 5 && hasWaitingOrders; i++) {
      await this.checkRunningPipelines();

      hasWaitingOrders = await this.startNewOrders();
    }
  }

  /**
   * Event handler for order completion - immediately continues the pipeline.
   * Uses atomic transaction with pessimistic lock to prevent race conditions with cron.
   */
  private async onOrderCompleted(event: OrderCompletionEvent): Promise<void> {
    try {
      this.logger.verbose(`Order ${event.orderId} completed, continuing pipeline ${event.pipelineId}`);

      // Atomically continue the pipeline (uses transaction + pessimistic lock)
      const pipeline = await this.pipelineRepo.tryContinuePipeline(event.pipelineId, event.status);

      if (!pipeline) {
        // Pipeline was already handled by cron or another event
        this.logger.verbose(`Pipeline ${event.pipelineId} not found or already processed`);
        return;
      }

      // Get the last order for completion/failure handling
      const lastOrder = await this.orderRepo.findOne({
        where: { pipeline: { id: pipeline.id } },
        order: { id: 'DESC' },
      });

      if (pipeline.status === LiquidityManagementPipelineStatus.COMPLETE) {
        await this.handlePipelineCompletion(pipeline);
        return;
      }

      if (
        [LiquidityManagementPipelineStatus.FAILED, LiquidityManagementPipelineStatus.STOPPED].includes(pipeline.status)
      ) {
        if (!lastOrder) {
          this.logger.error(`Pipeline ${pipeline.id} failed but no order found - data inconsistency`);
        }
        await this.handlePipelineFail(pipeline, lastOrder ?? null);
        return;
      }

      // Place and execute next order immediately
      this.logger.verbose(`Immediately continuing pipeline ${pipeline.id} with action ${pipeline.currentAction?.id}`);
      await this.placeLiquidityOrder(pipeline, lastOrder);

      // Find and execute the newly created order
      const newOrder = await this.orderRepo.findOne({
        where: { pipeline: { id: pipeline.id }, status: LiquidityManagementOrderStatus.CREATED },
        order: { id: 'DESC' },
      });

      if (newOrder) {
        try {
          await this.executeOrder(newOrder);
        } catch (e) {
          // Handle execution errors same as in startNewOrders
          // Important: Emit completion event to continue pipeline immediately
          if (e instanceof OrderNotNecessaryException) {
            newOrder.complete();
            await this.orderRepo.save(newOrder);
            this.orderCompletionService.emitOrderCompletion(newOrder, LiquidityManagementOrderStatus.COMPLETE);
          } else if (e instanceof OrderNotProcessableException) {
            newOrder.notProcessable(e);
            await this.orderRepo.save(newOrder);
            this.orderCompletionService.emitOrderCompletion(newOrder, LiquidityManagementOrderStatus.NOT_PROCESSABLE);
          } else if (e instanceof OrderFailedException) {
            newOrder.fail(e);
            await this.orderRepo.save(newOrder);
            this.orderCompletionService.emitOrderCompletion(newOrder, LiquidityManagementOrderStatus.FAILED);
          } else {
            // Unexpected error - log and don't emit event (will be retried by cron)
            this.logger.error(`Unexpected error executing order ${newOrder.id}:`, e);
            return;
          }
          this.logger.info(`Order ${newOrder.id} completed immediately with: ${e.message}`);
        }
      }
    } catch (e) {
      this.logger.error(`Error handling order completion for pipeline ${event.pipelineId}:`, e);
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
      status: In([LiquidityManagementOrderStatus.CREATED, LiquidityManagementOrderStatus.IN_PROGRESS]),
    });
  }

  async getPendingTx(): Promise<LiquidityManagementOrder[]> {
    return this.orderRepo.findBy({
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

  async startNewPipelines(): Promise<void> {
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
  }

  private async checkRunningPipelines(): Promise<void> {
    // Get list of running pipelines (without lock - just for iteration)
    const runningPipelines = await this.pipelineRepo.findBy({
      status: LiquidityManagementPipelineStatus.IN_PROGRESS,
    });

    for (const pipelineRef of runningPipelines) {
      try {
        const lastOrder = await this.orderRepo.findOne({
          where: { pipeline: { id: pipelineRef.id } },
          order: { id: 'DESC' },
        });

        // Check if order is in terminal state
        if (!lastOrder) {
          continue;
        }

        if (
          ![
            LiquidityManagementOrderStatus.COMPLETE,
            LiquidityManagementOrderStatus.FAILED,
            LiquidityManagementOrderStatus.NOT_PROCESSABLE,
          ].includes(lastOrder.status)
        ) {
          // Order still running
          continue;
        }

        // Use atomic method to continue pipeline (prevents race with event handler)
        const pipeline = await this.pipelineRepo.tryContinuePipeline(pipelineRef.id, lastOrder.status);

        if (!pipeline) {
          // Pipeline was already handled by event handler
          continue;
        }

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

        // Start new order
        this.logger.verbose(
          `Continue with next liquidity management pipeline action. Action ID: ${pipeline.currentAction?.id}`,
        );

        await this.placeLiquidityOrder(pipeline, lastOrder);
      } catch (e) {
        this.logger.error(`Error in checking running liquidity pipeline ${pipelineRef.id}:`, e);
        continue;
      }
    }
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
    let hasFinishedOrders = false;

    const newOrders = await this.orderRepo.findBy({ status: LiquidityManagementOrderStatus.CREATED });

    for (const order of newOrders) {
      try {
        await this.executeOrder(order);
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
        }

        hasFinishedOrders = true;

        this.logger.info(`Error in starting new liquidity order ${order.id}:`, e);
      }
    }

    return hasFinishedOrders;
  }

  private async executeOrder(order: LiquidityManagementOrder): Promise<void> {
    // Atomically claim this order - only one caller can succeed
    const gotLock = await this.orderRepo.tryClaimForExecution(order.id);
    if (!gotLock) {
      this.logger.verbose(`Order ${order.id} already being executed by another process`);
      return;
    }

    // We have the lock, proceed with execution
    try {
      const actionIntegration = this.actionIntegrationFactory.getIntegration(order.action);
      const correlationId = await actionIntegration.executeOrder(order);

      // Save all execution result fields (correlationId, inputAsset, outputAsset, inputAmount)
      // These are set on the order entity during executeOrder() and needed for WebSocket symbol construction
      await this.orderRepo.saveExecutionResult(
        order.id,
        correlationId,
        order.inputAsset,
        order.outputAsset,
        order.inputAmount,
      );

      // Start active polling to quickly detect order completion (fire-and-forget)
      void this.orderCompletionService.startActivePolling(order.id);
    } catch (e) {
      // If execution fails unexpectedly, revert to CREATED so it can be retried
      if (
        !(e instanceof OrderNotNecessaryException) &&
        !(e instanceof OrderNotProcessableException) &&
        !(e instanceof OrderFailedException)
      ) {
        this.logger.error(`Unexpected error executing order ${order.id}, reverting to CREATED:`, e);
        await this.orderRepo.revertToCREATED(order.id);
      }
      throw e;
    }
  }

  // Note: checkRunningOrders and checkOrder have been moved to OrderCompletionService

  private async handlePipelineCompletion(pipeline: LiquidityManagementPipeline): Promise<void> {
    const rule = pipeline.rule.reactivate();

    await this.ruleRepo.save(rule);

    const [successMessage, mailRequest] = this.generateSuccessMessage(pipeline);

    if (rule.sendNotifications) await this.notificationService.sendMail(mailRequest);

    this.logger.verbose(successMessage);
  }

  private async handlePipelineFail(
    pipeline: LiquidityManagementPipeline,
    order: LiquidityManagementOrder | null,
  ): Promise<void> {
    const rule = pipeline.rule.pause();

    await this.ruleRepo.save(rule);

    const [errorMessage, mailRequest] = this.generateFailMessage(pipeline, order);

    this.logger.info(errorMessage);

    if (rule.sendNotifications) await this.notificationService.sendMail(mailRequest);
  }

  private generateSuccessMessage(pipeline: LiquidityManagementPipeline): [string, MailRequest] {
    const { id, type, maxAmount, rule } = pipeline;
    const successMessage = `${type} pipeline for max. ${maxAmount} ${rule.targetName} (rule ${rule.id}) completed. Pipeline ID: ${id}`;

    const mailRequest: MailRequest = {
      type: MailType.ERROR_MONITORING,
      context: MailContext.LIQUIDITY_MANAGEMENT,
      input: {
        subject: 'Liquidity management pipeline SUCCESS',
        errors: [successMessage],
      },
    };

    return [successMessage, mailRequest];
  }

  private generateFailMessage(
    pipeline: LiquidityManagementPipeline,
    order: LiquidityManagementOrder | null,
  ): [string, MailRequest] {
    const { id, type, maxAmount, rule } = pipeline;
    const errorMessage = `${type} pipeline for max. ${maxAmount} ${rule.targetName} (rule ${
      rule.id
    }) ${pipeline.status.toLowerCase()}. Pipeline ID: ${id}`;

    const mailRequest: MailRequest = {
      type: MailType.ERROR_MONITORING,
      context: MailContext.LIQUIDITY_MANAGEMENT,
      input: {
        subject: 'Liquidity management pipeline FAIL',
        errors: [
          errorMessage,
          pipeline.status === LiquidityManagementPipelineStatus.FAILED
            ? `Error: ${order?.errorMessage ?? 'Unknown error (order not found)'}`
            : 'Maximum order count reached',
        ],
      },
    };

    return [errorMessage, mailRequest];
  }

  private logNewPipelines(newPipelines: LiquidityManagementPipeline[]): void {
    newPipelines.length > 0 &&
      this.logger.verbose(
        `Starting ${newPipelines.length} new liquidity management pipeline(s). Rules: ${newPipelines.map(
          (p) => p.rule.id,
        )}`,
      );
  }
}
