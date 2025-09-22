import { Injectable } from '@nestjs/common';
import { ExchangeRegistryService } from 'src/integration/exchange/services/exchange-registry.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { ReserveLiquidityRequest } from 'src/subdomains/supporting/dex/interfaces';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityManagementOrder } from '../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../enums';
import { OrderFailedException } from '../../exceptions/order-failed.exception';
import { OrderNotProcessableException } from '../../exceptions/order-not-processable.exception';
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

  constructor(
    private readonly dexService: DexService,
    private readonly exchangeRegistry: ExchangeRegistryService,
    private readonly assetService: AssetService,
  ) {
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
      maxAmount: amount,
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
      maxAmount: amount,
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
    const { address, assetId } = this.parseWithdrawParams(order.action.paramMap);
    const { minAmount, maxAmount } = order;

    const asset = assetId ? await this.assetService.getAssetById(assetId) : order.pipeline.rule.targetAsset;

    // fetch available liquidity
    const liquidityRequest: ReserveLiquidityRequest = {
      context: LiquidityOrderContext.LIQUIDITY_MANAGEMENT,
      correlationId: `${order.id}`,
      referenceAmount: minAmount,
      referenceAsset: asset,
      targetAsset: asset,
    };

    const {
      reference: { availableAmount },
    } = await this.dexService.checkLiquidity(liquidityRequest);

    if (availableAmount < minAmount) {
      throw new OrderNotProcessableException(
        `Not enough balance for ${asset.name} (balance: ${availableAmount}, min. requested: ${minAmount}, max. requested: ${maxAmount})`,
      );
    }

    const amount = Math.min(maxAmount, availableAmount);

    const request = {
      destinationAddress: address,
      asset,
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
    const { system, assetId } = this.parseWithdrawParams(order.action.paramMap);

    const exchange = this.exchangeRegistry.get(system);

    const sourceAsset = assetId ? await this.assetService.getAssetById(assetId) : undefined;
    const sourceChain = sourceAsset && exchange.mapNetwork(sourceAsset.blockchain);

    const targetAsset = order.pipeline.rule.targetAsset;

    const deposits = await exchange.getDeposits(targetAsset.dexName, order.created, sourceChain || undefined);
    const deposit = deposits.find((d) => d.amount === order.inputAmount && d.timestamp > order.created.getTime());

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
    assetId?: number;
  } {
    const address = process.env[params.destinationAddress as string];
    const system = params.destinationSystem as LiquidityManagementSystem;
    const assetId = params.assetId as number | undefined;

    const isValid = this.withdrawParamsValid(address, system);
    if (!isValid) throw new Error(`Params provided to DfxDexAdapter.withdraw(...) command are invalid.`);

    return { address, system, assetId };
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
