import { Injectable } from '@nestjs/common';
import { ExchangeRegistryService } from 'src/integration/exchange/services/exchange-registry.service';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityManagementOrder } from '../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../enums';
import { OrderNotProcessableException } from '../../exceptions/order-not-processable.exception';
import { Command, CorrelationId } from '../../interfaces';
import { LiquidityManagementAdapter } from './base/liquidity-management.adapter';

export interface DfxDexWithdrawParams {
  destinationAddress: string;
  destinationSystem: LiquidityManagementSystem;
}

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
export class DfxDexAdapter extends LiquidityManagementAdapter {
  protected commands = new Map<string, Command>();

  constructor(private readonly dexService: DexService, private readonly registryService: ExchangeRegistryService) {
    super(LiquidityManagementSystem.DFX_DEX);

    this.commands.set(DfxDexAdapterCommands.PURCHASE, this.purchase);
    this.commands.set(DfxDexAdapterCommands.SELL, this.sell);
    this.commands.set(DfxDexAdapterCommands.WITHDRAW, this.withdraw);
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

  validateParams(command: string, params: any): boolean {
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

  //*** COMMANDS IMPLEMENTATIONS ***//

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
    const { address } = this.parseAndValidateParams(order.action.params);
    const { amount } = order;

    const request = {
      destinationAddress: address,
      asset: order.pipeline.rule.targetAsset,
      amount,
    };

    return this.dexService.transferLiquidity(request);
  }

  //*** HELPER METHODS ***//

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
      throw new OrderNotProcessableException(e.message);
    }
  }

  private async checkWithdrawCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const { system } = this.parseAndValidateParams(order.action.params);

    const exchange = this.registryService.getExchange(system.toLowerCase());

    const deposits = await exchange.getDeposits(order.pipeline.rule.targetAsset.dexName, order.created);
    // TODO - what could be other search criteria to avoid false positive.
    const deposit = deposits.find((d) => d.amount === order.amount);

    return deposit && deposit.status === 'ok';
  }

  private parseAndValidateParams(_params: any): { address: string; system: LiquidityManagementSystem } {
    const params = this.parseActionParams<DfxDexWithdrawParams>(_params);
    const isValid = this.validateWithdrawParams(params);

    if (!isValid) throw new Error(`Params provided to DfxDexAdapter.withdraw(...) command are invalid.`);

    return this.mapWithdrawParams(params);
  }

  private validateWithdrawParams(params: any): boolean {
    try {
      const { address, system } = this.mapWithdrawParams(params);

      return !!(
        address &&
        system &&
        Object.values(LiquidityManagementSystem).includes(system) &&
        this.registryService.getExchange(system.toLowerCase())
      );
    } catch {
      return false;
    }
  }

  private mapWithdrawParams(params: DfxDexWithdrawParams): { address: string; system: LiquidityManagementSystem } {
    const address = process.env[params.destinationAddress];
    const system = process.env[params.destinationSystem] as LiquidityManagementSystem;

    return { address, system };
  }
}
