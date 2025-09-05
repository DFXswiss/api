import { Injectable, NotFoundException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ExchangeRegistryService } from 'src/integration/exchange/services/exchange-registry.service';
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
import { LiquidityManagementOrderStatus, LiquidityManagementPipelineStatus } from '../enums';
import { OrderFailedException } from '../exceptions/order-failed.exception';
import { OrderNotNecessaryException } from '../exceptions/order-not-necessary.exception';
import { OrderNotProcessableException } from '../exceptions/order-not-processable.exception';
import { LiquidityActionIntegrationFactory } from '../factories/liquidity-action-integration.factory';
import { LiquidityManagementOrderRepository } from '../repositories/liquidity-management-order.repository';
import { LiquidityManagementPipelineRepository } from '../repositories/liquidity-management-pipeline.repository';
import { LiquidityManagementRuleRepository } from '../repositories/liquidity-management-rule.repository';

@Injectable()
export class LiquidityManagementPipelineService {
  private readonly logger = new DfxLogger(LiquidityManagementPipelineService);

  constructor(
    private readonly ruleRepo: LiquidityManagementRuleRepository,
    private readonly orderRepo: LiquidityManagementOrderRepository,
    private readonly pipelineRepo: LiquidityManagementPipelineRepository,
    private readonly actionIntegrationFactory: LiquidityActionIntegrationFactory,
    private readonly notificationService: NotificationService,
    private readonly exchangeRegistry: ExchangeRegistryService,
  ) {}

  //*** JOBS ***//

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.LIQUIDITY_MANAGEMENT, timeout: 1800 })
  async processPipelines() {
    // temporary log
    await this.usdtDebugLog();

    await this.checkRunningOrders();
    await this.startNewPipelines();

    let hasWaitingOrders = true;
    for (let i = 0; i < 5 && hasWaitingOrders; i++) {
      await this.checkRunningPipelines();

      hasWaitingOrders = await this.startNewOrders();
    }
  }

  private async usdtDebugLog() {
    // exchange balances
    const [kraken, binance] = await Promise.all(
      ['Kraken', 'Binance'].map((id) =>
        this.exchangeRegistry
          .get(id)
          .getTotalBalances()
          .then((b) => Math.round(b['USDT'] ?? 0)),
      ),
    );

    // transfer
    const lmOrders = await this.orderRepo.findBy({
      status: LiquidityManagementOrderStatus.IN_PROGRESS,
      action: { id: 138 },
    });
    const transfer = Math.round(Util.sumObjValue(lmOrders, 'inputAmount'));

    this.logger.verbose(`USDT balances: Kraken ${kraken}, Binance ${binance}, Transfer ${transfer}`);
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
    const runningPipelines = await this.pipelineRepo.find({
      where: { status: LiquidityManagementPipelineStatus.IN_PROGRESS },
      relations: { currentAction: { onSuccess: true, onFail: true } },
    });

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
      } catch (e) {
        this.logger.error(`Error in checking running liquidity pipeline ${pipeline.id}:`, e);
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
        }
        if (e instanceof OrderNotProcessableException) {
          order.notProcessable(e);
          await this.orderRepo.save(order);
        }
        if (e instanceof OrderFailedException) {
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
    const actionIntegration = this.actionIntegrationFactory.getIntegration(order.action);

    const correlationId = await actionIntegration.executeOrder(order);
    order.inProgress(correlationId);

    await this.orderRepo.save(order);
  }

  private async checkRunningOrders(): Promise<void> {
    const runningOrders = await this.orderRepo.findBy({ status: LiquidityManagementOrderStatus.IN_PROGRESS });

    for (const order of runningOrders) {
      try {
        await this.checkOrder(order);
      } catch (e) {
        if (e instanceof OrderNotProcessableException) {
          order.notProcessable(e);
          await this.orderRepo.save(order);
          continue;
        }
        if (e instanceof OrderFailedException) {
          order.fail(e);
          await this.orderRepo.save(order);
          continue;
        }

        this.logger.error(`Error in checking running liquidity order ${order.id}:`, e);
      }
    }
  }

  private async checkOrder(order: LiquidityManagementOrder): Promise<void> {
    const actionIntegration = this.actionIntegrationFactory.getIntegration(order.action);
    const isComplete = await actionIntegration.checkCompletion(order);

    if (isComplete) {
      order.complete();
      await this.orderRepo.save(order);

      this.logger.verbose(`Liquidity management order ${order.id} complete`);
    }
  }

  private async handlePipelineCompletion(pipeline: LiquidityManagementPipeline): Promise<void> {
    const rule = pipeline.rule.reactivate();

    await this.ruleRepo.save(rule);

    const [successMessage, mailRequest] = this.generateSuccessMessage(pipeline);

    if (rule.sendNotifications) await this.notificationService.sendMail(mailRequest);

    this.logger.verbose(successMessage);
  }

  private async handlePipelineFail(
    pipeline: LiquidityManagementPipeline,
    order: LiquidityManagementOrder,
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
    order: LiquidityManagementOrder,
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
            ? `Error: ${order.errorMessage}`
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
