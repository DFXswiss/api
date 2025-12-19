import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { LiquidityManagementPipeline } from '../entities/liquidity-management-pipeline.entity';
import { LiquidityManagementOrderStatus, LiquidityManagementPipelineStatus } from '../enums';

@Injectable()
export class LiquidityManagementPipelineRepository extends BaseRepository<LiquidityManagementPipeline> {
  constructor(manager: EntityManager) {
    super(LiquidityManagementPipeline, manager);
  }

  /**
   * Atomically continues a pipeline within a transaction with pessimistic lock.
   * This prevents race conditions between event handlers and cron jobs.
   * @returns the updated pipeline, or null if pipeline not found or not in progress
   */
  async tryContinuePipeline(
    pipelineId: number,
    lastOrderStatus: LiquidityManagementOrderStatus,
  ): Promise<LiquidityManagementPipeline | null> {
    return this.manager.transaction(async (transactionalManager) => {
      // Lock the pipeline row for this transaction
      const pipeline = await transactionalManager
        .createQueryBuilder(LiquidityManagementPipeline, 'p')
        .setLock('pessimistic_write')
        .leftJoinAndSelect('p.currentAction', 'currentAction')
        .leftJoinAndSelect('currentAction.onSuccess', 'onSuccess')
        .leftJoinAndSelect('currentAction.onFail', 'onFail')
        .leftJoinAndSelect('p.rule', 'rule')
        .where('p.id = :id AND p.status = :status', {
          id: pipelineId,
          status: LiquidityManagementPipelineStatus.IN_PROGRESS,
        })
        .getOne();

      if (!pipeline) {
        return null; // Pipeline not found or already completed/failed
      }

      // Continue the pipeline (state machine logic)
      pipeline.continue(lastOrderStatus);

      // Save within the same transaction
      return transactionalManager.save(pipeline);
    });
  }
}
