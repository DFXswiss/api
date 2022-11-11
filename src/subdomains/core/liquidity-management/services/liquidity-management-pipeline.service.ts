import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { LiquidityManagementOrder } from '../entities/liquidity-management-order.entity';
import { LiquidityManagementOrderStatus, LiquidityManagementPipelineStatus } from '../enums';
import { OrderNotProcessableException } from '../exceptions/order-not-processable.exception';
import { LiquidityManagementOrderRepository } from '../repositories/liquidity-management-order.repository';
import { LiquidityManagementPipelineRepository } from '../repositories/liquidity-management-pipeline.repository';
import { LiquidityManagementPipeline } from '../entities/liquidity-management-pipeline.entity';
import { Lock } from 'src/shared/utils/lock';
import { LiquidityManagementRuleService } from './liquidity-management-rule.service';

@Injectable()
export class LiquidityManagementPipelineService {
  private readonly processPipelinesLock = new Lock(1800);
  private readonly processOrdersLock = new Lock(1800);

  constructor(
    private readonly orderRepo: LiquidityManagementOrderRepository,
    private readonly pipelineRepo: LiquidityManagementPipelineRepository,
    private readonly ruleService: LiquidityManagementRuleService,
  ) {}

  //*** JOBS ***//

  @Interval(60000)
  async processPipelines() {
    if (!this.processPipelinesLock.acquire()) return;

    try {
      await this.startNewPipelines();
      await this.checkRunningPipelines();
    } catch (e) {
    } finally {
      this.processPipelinesLock.release();
    }
  }

  @Interval(60000)
  async processOrders() {
    if (!this.processOrdersLock.acquire()) return;

    try {
      await this.startNewOrders();
      await this.checkRunningOrders();
    } catch (e) {
    } finally {
      this.processOrdersLock.release();
    }
  }

  //*** HELPER METHODS ***//

  async startNewPipelines(): Promise<void> {
    const newPipelines = await this.pipelineRepo.find({
      where: { status: LiquidityManagementPipelineStatus.CREATED },
    });

    for (const pipeline of newPipelines) {
      try {
        pipeline.start();
        await this.pipelineRepo.save(pipeline);
      } catch (e) {
        console.error(`Error in starting new liquidity pipeline. Pipeline ID: ${pipeline.id}`, e);
        continue;
      }
    }
  }

  private async checkRunningPipelines(): Promise<void> {
    const runningPipelines = await this.pipelineRepo.find({
      where: { status: LiquidityManagementPipelineStatus.IN_PROGRESS },
    });

    for (const pipeline of runningPipelines) {
      try {
        const order = await this.orderRepo.findOne({ pipeline, action: pipeline.currentAction });

        if (!order) {
          await this.placeLiquidityOrder(pipeline);
          continue;
        }

        if (
          order.status === LiquidityManagementOrderStatus.COMPLETE ||
          order.status === LiquidityManagementOrderStatus.FAILED
        ) {
          pipeline.continue(order.status);
          await this.pipelineRepo.save(pipeline);
        }
      } catch (e) {
        console.error(`Error in checking running liquidity pipeline. Pipeline ID: ${pipeline.id}`, e);
        continue;
      }
    }
  }

  private async placeLiquidityOrder(pipeline: LiquidityManagementPipeline): Promise<void> {
    const { targetAmount, currentAction } = pipeline;
    const order = LiquidityManagementOrder.create(targetAmount, pipeline, currentAction);

    await this.orderRepo.save(order);
  }

  private async startNewOrders(): Promise<void> {
    const newOrders = await this.orderRepo.find({ status: LiquidityManagementOrderStatus.CREATED });

    for (const order of newOrders) {
      try {
        await this.executeOrder(order);
      } catch (e) {
        if (e instanceof OrderNotProcessableException) {
          order.fail();
          await this.orderRepo.save(order);
          continue;
        }

        console.error(`Error in starting new liquidity order. Order ID: ${order.id}`, e);
      }
    }
  }

  private async executeOrder(order: LiquidityManagementOrder): Promise<void> {
    const actionIntegration = await this.ruleService.findLiquidityActionIntegration(order.action);

    await actionIntegration.runCommand(order.action.command);
    order.inProgress();

    await this.orderRepo.save(order);
  }

  private async checkRunningOrders(): Promise<void> {
    const runningOrders = await this.orderRepo.find({ status: LiquidityManagementOrderStatus.IN_PROGRESS });

    for (const order of runningOrders) {
      try {
        await this.checkOrder(order);
      } catch (e) {
        if (e instanceof OrderNotProcessableException) {
          order.fail();
          await this.orderRepo.save(order);
          continue;
        }

        console.error(`Error in checking running liquidity order. Order ID: ${order.id}`, e);
      }
    }
  }

  private async checkOrder(order: LiquidityManagementOrder): Promise<void> {
    const actionIntegration = await this.ruleService.findLiquidityActionIntegration(order.action);
    const isComplete = await actionIntegration.checkCompletion();

    if (isComplete) {
      order.complete();
      await this.orderRepo.save(order);
    }
  }
}
