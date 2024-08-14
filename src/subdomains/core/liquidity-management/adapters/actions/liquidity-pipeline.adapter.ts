import { Injectable } from '@nestjs/common';
import { LiquidityManagementOrder } from '../../entities/liquidity-management-order.entity';
import { LiquidityManagementPipelineStatus, LiquidityManagementSystem } from '../../enums';
import { OrderNotProcessableException } from '../../exceptions/order-not-processable.exception';
import { Command, CorrelationId } from '../../interfaces';
import { LiquidityManagementOrderRepository } from '../../repositories/liquidity-management-order.repository';
import { LiquidityManagementPipelineRepository } from '../../repositories/liquidity-management-pipeline.repository';
import { LiquidityManagementService } from '../../services/liquidity-management.service';
import { LiquidityActionAdapter } from './base/liquidity-action.adapter';

/**
 * @note
 * commands should be lower-case
 */
export enum LiquidityPipelineAdapterCommands {
  BUY = 'buy',
}

@Injectable()
export class LiquidityPipelineAdapter extends LiquidityActionAdapter {
  protected commands = new Map<string, Command>();

  constructor(
    private readonly liquidityManagementService: LiquidityManagementService,
    private readonly pipelineRepo: LiquidityManagementPipelineRepository,
    private readonly orderRepo: LiquidityManagementOrderRepository,
  ) {
    super(LiquidityManagementSystem.LIQUIDITY_PIPELINE);

    this.commands.set(LiquidityPipelineAdapterCommands.BUY, this.buy.bind(this));
  }

  async checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    switch (order.action.command) {
      case LiquidityPipelineAdapterCommands.BUY:
        return this.checkBuyCompletion(order);

      default:
        return false;
    }
  }

  validateParams(command: string, params: Record<string, unknown>): boolean {
    switch (command) {
      case LiquidityPipelineAdapterCommands.BUY:
        return this.validateBuyParams(params);

      default:
        throw new Error(`Command ${command} not supported by LiquidityPipelineAdapter`);
    }
  }

  // --- COMMAND IMPLEMENTATIONS --- //

  private async buy(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const { assetId } = this.parseBuyParams(order.action.paramMap);

    // get amount from previous order
    const previousOrder = order.previousOrderId && (await this.orderRepo.findOneBy({ id: order.previousOrderId }));
    const [_, balance, requested] = /\(balance: (.*), requested: (.*)\)/.exec(previousOrder?.errorMessage ?? '') ?? [];

    if (!balance || !requested)
      throw new Error(`Error (${previousOrder?.errorMessage}) of previous order ${order.previousOrderId} is invalid`);

    const amount = +requested;

    const pipelineId = await this.liquidityManagementService.buyLiquidity(assetId, amount, true);
    return pipelineId.toString();
  }

  // --- COMPLETION CHECKS --- //
  private async checkBuyCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const pipeline = await this.pipelineRepo.findOneBy({ id: +order.correlationId });

    switch (pipeline.status) {
      case LiquidityManagementPipelineStatus.CREATED:
      case LiquidityManagementPipelineStatus.IN_PROGRESS:
        return false;

      case LiquidityManagementPipelineStatus.COMPLETE:
        return true;

      case LiquidityManagementPipelineStatus.STOPPED:
      case LiquidityManagementPipelineStatus.FAILED:
        throw new OrderNotProcessableException(
          `Triggered pipeline ${pipeline.id} failed with status ${pipeline.status}`,
        );
    }
  }

  // --- PARAM VALIDATION --- //

  private validateBuyParams(params: Record<string, unknown>): boolean {
    try {
      this.parseBuyParams(params);
      return true;
    } catch {
      return false;
    }
  }

  private parseBuyParams(params: Record<string, unknown>): { assetId: number } {
    const assetId = params.assetId as number | undefined;

    if (!assetId) throw new Error(`Params provided to LiquidityPipelineAdapter.buy(...) command are invalid.`);

    return { assetId };
  }
}
