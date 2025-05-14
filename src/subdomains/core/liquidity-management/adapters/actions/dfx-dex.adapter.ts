import { Injectable } from '@nestjs/common';
import { ExchangeRegistryService } from 'src/integration/exchange/services/exchange-registry.service';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityManagementOrder } from '../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../enums';
import { OrderFailedException } from '../../exceptions/order-failed.exception';
import { Command, CorrelationId } from '../../interfaces';
import { LiquidityActionAdapter } from './base/liquidity-action.adapter';

/**
 * @note
 * commands should be lower-case
 */
export enum DfxDexAdapterCommands {
  PURCHASE = 'purchase',
  SELL = 'sell',
  WITHDRAW = 'withdraw',
}

@Injectable()
export class DfxDexAdapter extends LiquidityActionAdapter {
  protected commands = new Map<string, Command>();

  constructor(private readonly dexService: DexService, private readonly exchangeRegistry: ExchangeRegistryService) {
    super(LiquidityManagementSystem.DFX_DEX);

    this.commands.set(DfxDexAdapterCommands.PURCHASE, this.purchase.bind(this));
    this.commands.set(DfxDexAdapterCommands.SELL, this.sell.bind(this));
    this.commands.set(DfxDexAdapterCommands.WITHDRAW, this.withdraw.bind(this));
  }

  async checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    switch (order.action.command) {
      case DfxDexAdapterCommands.PURCHASE:
        return this.checkSellPurchaseCompletion(order);

      case DfxDexAdapterCommands.SELL:
        return this.checkSellPurchaseCompletion(order);

      case DfxDexAdapterCommands.WITHDRAW:
        return this.checkWithdrawCompletion(order);

      default:
        return false;
    }
  }

  validateParams(command: string, params: Record<string, unknown>): boolean {
    switch (command) {
      case DfxDexAdapterCommands.WITHDRAW:
        return this.validateWithdrawParams(params);

      case DfxDexAdapterCommands.PURCHASE:
        return true;

      case DfxDexAdapterCommands.SELL:
        return true;

      default:
        throw new Error(`Command ${command} not supported by DfxDexAdapter`);
    }
  }

  // --- COMMAND IMPLEMENTATIONS --- //

  /**
   * @note
   * correlationId is the orderId and set by liquidity management
   */
  private async purchase(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const {
      pipeline: {
        rule: { targetAsset: asset },
      },
      amount,
      id: correlationId,
    } = order;

    const request = {
      context: LiquidityOrderContext.LIQUIDITY_MANAGEMENT,
      correlationId: correlationId.toString(),
      referenceAsset: asset,
      referenceAmount: amount,
      targetAsset: asset,
    };

    await this.dexService.purchaseLiquidity(request);

    return correlationId.toString();
  }

  /**
   * @note
   * correlationId is the orderId and set by liquidity management
   */
  private async sell(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const {
      pipeline: {
        rule: { targetAsset: asset },
      },
      amount,
      id: correlationId,
    } = order;

    const request = {
      context: LiquidityOrderContext.LIQUIDITY_MANAGEMENT,
      correlationId: correlationId.toString(),
      sellAsset: asset,
      sellAmount: amount,
    };

    await this.dexService.sellLiquidity(request);

    return correlationId.toString();
  }

  private async withdraw(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const { address } = this.parseWithdrawParams(order.action.paramMap);
    const { amount } = order;

    const request = {
      destinationAddress: address,
      asset: order.pipeline.rule.targetAsset,
      amount,
    };

    order.inputAmount = amount;
    order.inputAsset = request.asset.name;

    return this.dexService.transferLiquidity(request);
  }

  // --- COMPLETION CHECKS --- //

  private async checkSellPurchaseCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    try {
      const result = await this.dexService.checkOrderReady(
        LiquidityOrderContext.LIQUIDITY_MANAGEMENT,
        order.correlationId,
      );

      if (result.isReady) {
        await this.dexService.completeOrders(LiquidityOrderContext.LIQUIDITY_MANAGEMENT, order.correlationId);
      }

      return result.isReady;
    } catch (e) {
      throw new OrderFailedException(e.message);
    }
  }

  private async checkWithdrawCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const { system } = this.parseWithdrawParams(order.action.paramMap);

    const exchange = this.exchangeRegistry.get(system);

    const deposits = await exchange.getDeposits(order.pipeline.rule.targetAsset.dexName, order.created);
    const deposit = deposits.find((d) => d.amount === order.amount && d.timestamp > order.created.getTime());

    const isComplete = deposit && deposit.status === 'ok';
    if (isComplete) {
      order.outputAmount = deposit.amount;
      order.outputAsset = deposit.currency;
    }

    return isComplete;
  }

  // --- PARAM VALIDATION --- //
  private validateWithdrawParams(params: Record<string, unknown>): boolean {
    try {
      this.parseWithdrawParams(params);
      return true;
    } catch {
      return false;
    }
  }

  private parseWithdrawParams(params: Record<string, unknown>): {
    address: string;
    system: LiquidityManagementSystem;
  } {
    const address = process.env[params.destinationAddress as string];
    const system = params.destinationSystem as LiquidityManagementSystem;

    const isValid = this.withdrawParamsValid(address, system);
    if (!isValid) throw new Error(`Params provided to DfxDexAdapter.withdraw(...) command are invalid.`);

    return { address, system };
  }

  private withdrawParamsValid(address: string, system: LiquidityManagementSystem): boolean {
    return !!(
      address &&
      system &&
      Object.values(LiquidityManagementSystem).includes(system) &&
      this.exchangeRegistry.get(system)
    );
  }
}
