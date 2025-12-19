import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { LiquidityManagementOrder } from '../entities/liquidity-management-order.entity';
import { LiquidityManagementOrderStatus } from '../enums';

@Injectable()
export class LiquidityManagementOrderRepository extends BaseRepository<LiquidityManagementOrder> {
  constructor(manager: EntityManager) {
    super(LiquidityManagementOrder, manager);
  }

  /**
   * Atomically tries to claim an order for execution by transitioning from CREATED to IN_PROGRESS.
   * Uses UPDATE with WHERE clause to prevent race conditions - only one caller can succeed.
   * @returns true if this call successfully acquired the lock, false if already taken
   */
  async tryClaimForExecution(orderId: number): Promise<boolean> {
    const result = await this.createQueryBuilder()
      .update(LiquidityManagementOrder)
      .set({
        status: LiquidityManagementOrderStatus.IN_PROGRESS,
      })
      .where('id = :id AND status = :status', {
        id: orderId,
        status: LiquidityManagementOrderStatus.CREATED,
      })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  /**
   * Updates all execution result fields after successful exchange execution.
   * This includes correlationId, inputAsset, outputAsset, and inputAmount.
   */
  async saveExecutionResult(
    orderId: number,
    correlationId: string,
    inputAsset: string,
    outputAsset: string,
    inputAmount: number,
  ): Promise<void> {
    await this.update(orderId, { correlationId, inputAsset, outputAsset, inputAmount });
  }

  /**
   * @deprecated Use saveExecutionResult instead to save all execution fields
   */
  async setCorrelationId(orderId: number, correlationId: string): Promise<void> {
    await this.update(orderId, { correlationId });
  }

  /**
   * Reverts an order back to CREATED if execution failed unexpectedly.
   * This allows the order to be retried by the next cron run.
   */
  async revertToCREATED(orderId: number): Promise<void> {
    await this.update(orderId, { status: LiquidityManagementOrderStatus.CREATED });
  }
}
