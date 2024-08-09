import { LiquidityManagementOrder } from '../../entities/liquidity-management-order.entity';
import { LiquidityManagementPipelineStatus, LiquidityManagementSystem } from '../../enums';
import { OrderNotProcessableException } from '../../exceptions/order-not-processable.exception';
import { Command, CorrelationId } from '../../interfaces';
import { LiquidityManagementOrderRepository } from '../../repositories/liquidity-management-order.repository';
import { LiquidityManagementPipelineService } from '../../services/liquidity-management-pipeline.service';
import { LiquidityManagementService } from '../../services/liquidity-management.service';
import { LiquidityActionAdapter } from './base/liquidity-action.adapter';

/**
 * @note
 * commands should be lower-case
 */
export enum LiquidityManagementAdapterCommands {
  BUY = 'buy',
}

export class LiquidityManagementAdapter extends LiquidityActionAdapter {
  protected commands = new Map<string, Command>();

  constructor(
    system: LiquidityManagementSystem,
    private readonly liquidityManagementService: LiquidityManagementService,
    private readonly pipelineService: LiquidityManagementPipelineService,
    private readonly orderRepo: LiquidityManagementOrderRepository,
  ) {
    super(system);

    this.commands.set(LiquidityManagementAdapterCommands.BUY, this.buy.bind(this));
  }

  async checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    switch (order.action.command) {
      case LiquidityManagementAdapterCommands.BUY:
        return this.checkBuyCompletion(order);

      default:
        return false;
    }
  }

  validateParams(command: string, params: Record<string, unknown>): boolean {
    switch (command) {
      case LiquidityManagementAdapterCommands.BUY:
        return this.validateBuyParams(params);

      default:
        throw new Error(`Command ${command} not supported by LiquidityManagementAdapter`);
    }
  }

  // --- COMMAND IMPLEMENTATIONS --- //

  private async buy(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const { assetId } = this.parseBuyParams(order.action.paramMap);

    // get amount from previous order
    const previousOrder = order.previousOrderId && (await this.orderRepo.findOneBy({ id: order.previousOrderId }));
    const [_, balance, requested] =
      /balance: (\d+(?:\.\d+)?), requested: (\d+(?:\.\d+)?)/.exec(previousOrder?.errorMessage ?? '') ?? [];

    if (!balance || !requested)
      throw new Error(`Error (${previousOrder?.errorMessage}) of previous order ${order.previousOrderId} is invalid`);

    const amount = +requested - +balance;

    const pipelineId = await this.liquidityManagementService.buyLiquidity(assetId, amount, true);
    return pipelineId.toString();
  }

  // --- COMPLETION CHECKS --- //
  private async checkBuyCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const pipelineState = await this.pipelineService.getPipelineStatus(+order.correlationId);

    switch (pipelineState) {
      case LiquidityManagementPipelineStatus.CREATED:
      case LiquidityManagementPipelineStatus.IN_PROGRESS:
        return false;

      case LiquidityManagementPipelineStatus.COMPLETE:
        return true;

      case LiquidityManagementPipelineStatus.STOPPED:
      case LiquidityManagementPipelineStatus.FAILED:
        throw new OrderNotProcessableException(`Triggered pipeline failed with status ${pipelineState}`);
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

    if (!assetId) throw new Error(`Params provided to LiquidityManagementAdapter.buy(...) command are invalid.`);

    return { assetId };
  }
}
