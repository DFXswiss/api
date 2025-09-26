import { Injectable } from '@nestjs/common';
import { Equal } from 'typeorm';
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
    const { assetId, orderIndex, demandOnly } = this.parseBuyParams(order.action.paramMap);

    // get amount from previous order
    let relevantOrder = order;
    for (let index = 0; index < orderIndex; index++) {
      relevantOrder = await this.orderRepo.findOneBy({ id: Equal(relevantOrder.previousOrderId) });
      if (!relevantOrder) throw new Error(`Previous order ${index + 1} not found`);
    }

    const [_, balance, minRequested, maxRequested] =
      /\(balance: (.*), min. requested: (.*), max. requested: (.*)\)/.exec(relevantOrder?.errorMessage ?? '') ?? [];

    if (!balance || !minRequested || !maxRequested)
      throw new Error(`Error (${relevantOrder?.errorMessage}) of previous order ${relevantOrder.id} is invalid`);

    const minAmount = +minRequested - +balance;
    const maxAmount = +maxRequested - +balance;

    const pipeline = await this.liquidityManagementService.buyLiquidity(
      assetId,
      minAmount,
      demandOnly ? minAmount : maxAmount,
      true,
    );
    return pipeline.id.toString();
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
        const failedOrder = await this.orderRepo.findOne({
          where: { pipeline: { id: pipeline.id } },
          order: { id: 'DESC' },
        });

        throw new OrderNotProcessableException(
          `Triggered pipeline ${pipeline.id} (rule ${pipeline.rule.id}) for ${pipeline.rule.targetAsset.uniqueName} failed with error: ${failedOrder.errorMessage}`,
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

  private parseBuyParams(params: Record<string, unknown>): {
    assetId: number;
    orderIndex: number;
    demandOnly: boolean;
  } {
    const assetId = params.assetId as number | undefined;
    const orderIndex = (params.orderIndex as number | undefined) ?? 1;
    const demandOnly = Boolean(params.demandOnly);

    if (!assetId || (orderIndex && orderIndex < 1))
      throw new Error(`Params provided to LiquidityPipelineAdapter.buy(...) command are invalid.`);

    return { assetId, orderIndex, demandOnly };
  }
}
