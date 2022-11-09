import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { LiquidityManagementOrder } from '../entities/liquidity-management-order.entity';
import { LiquidityManagementAction } from '../entities/liquidity-management-action.entity';
import { LiquidityManagementOrderStatus, LiquidityManagementPipelineStatus } from '../enums';
import { OrderNotProcessableException } from '../exceptions/order-not-processable.exception';
import { LiquidityActionIntegrationFactory } from '../factories/liquidity-processor.factory';
import { LiquidityActionIntegration } from '../interfaces';
import { LiquidityManagementOrderRepository } from '../repositories/liquidity-management-order.repository';
import { LiquidityManagementPipelineRepository } from '../repositories/liquidity-management-pipeline.repository';
import { LiquidityManagementPipeline } from '../entities/liquidity-management-pipeline.entity';

@Injectable()
export class LiquidityManagementPipelineService {
  constructor(
    private readonly orderRepo: LiquidityManagementOrderRepository,
    private readonly pipelineRepo: LiquidityManagementPipelineRepository,
    private readonly liquidityActionIntegrationFactory: LiquidityActionIntegrationFactory,
  ) {}

  //*** JOBS ***//

  @Interval(60000)
  async processPipelines() {
    await this.startNewPipelines();
    await this.checkRunningPipelines();
  }

  @Interval(60000)
  async processOrders() {
    await this.startNewOrders();
    await this.checkRunningOrders();
  }

  //*** HELPER METHODS ***//

  async startNewPipelines(): Promise<void> {
    const newPipelines = await this.pipelineRepo.find({
      where: { status: LiquidityManagementPipelineStatus.CREATED },
    });

    for (const pipeline of newPipelines) {
      pipeline.start();
      await this.pipelineRepo.save(pipeline);
    }
  }

  private async checkRunningPipelines(): Promise<void> {
    const runningPipelines = await this.pipelineRepo.find({
      where: { status: LiquidityManagementPipelineStatus.IN_PROGRESS },
    });

    for (const pipeline of runningPipelines) {
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
        }
      }
    }
  }

  private async executeOrder(order: LiquidityManagementOrder): Promise<void> {
    const actionIntegration = await this.findLiquidityActionIntegration(order.action);

    await actionIntegration.runCommand(order.action.command);
    order.inProgress();

    await this.orderRepo.save(order);
  }

  private async findLiquidityActionIntegration(action: LiquidityManagementAction): Promise<LiquidityActionIntegration> {
    return this.liquidityActionIntegrationFactory.getIntegration(action);
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
        }
      }
    }
  }

  private async checkOrder(order: LiquidityManagementOrder): Promise<void> {
    const actionIntegration = await this.findLiquidityActionIntegration(order.action);
    const isComplete = await actionIntegration.checkCompletion();

    if (isComplete) {
      order.complete();
      await this.orderRepo.save(order);
    }
  }
}
