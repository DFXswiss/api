import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ExchangeRegistryService } from 'src/integration/exchange/services/exchange-registry.service';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
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
      case DfxDexAdapterCommands.SELL:
        return this.checkSwapCompletion(order);

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
      case DfxDexAdapterCommands.SELL:
        return this.validateSwapParams(params);

      default:
        throw new Error(`Command ${command} not supported by DfxDexAdapter`);
    }
  }

  // --- COMMAND IMPLEMENTATIONS --- //

  /**
   * @note
   * correlationId is the orderId and set by liquidity management.
   * targetAsset (from rule) is what we're buying, swapAsset is what we spend.
   * Amount is in target asset (targetAsset).
   */
  private async purchase(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const {
      pipeline: {
        rule: { targetAsset },
      },
      id: correlationId,
      minAmount,
      maxAmount,
    } = order;

    const { swapAsset: swapAssetName } = this.parseSwapParams(order.action.paramMap);
    const swapAsset = await this.getSwapAsset(targetAsset.blockchain, swapAssetName);

    const price = await this.dexService.calculatePrice(swapAsset, targetAsset);
    const minSwapAmount = minAmount * price;
    const maxSwapAmount = maxAmount * price;

    const swapLiquidity = await this.resolveSwapLiquidity(
      correlationId.toString(),
      swapAsset,
      minSwapAmount,
      maxSwapAmount,
    );

    order.inputAmount = swapLiquidity.amount;
    order.inputAsset = swapLiquidity.asset.name;

    const request = {
      context: LiquidityOrderContext.LIQUIDITY_MANAGEMENT,
      correlationId: correlationId.toString(),
      referenceAsset: swapLiquidity.asset,
      referenceAmount: swapLiquidity.amount,
      targetAsset,
    };

    await this.dexService.purchaseLiquidity(request);

    return correlationId.toString();
  }

  /**
   * @note
   * correlationId is the orderId and set by liquidity management.
   * targetAsset (from rule) is what we're selling, swapAsset is what we receive.
   * Amount is in source asset (targetAsset).
   */
  private async sell(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const {
      pipeline: {
        rule: { targetAsset },
      },
      id: correlationId,
      minAmount,
      maxAmount,
    } = order;

    const { swapAsset: swapAssetName } = this.parseSwapParams(order.action.paramMap);
    const swapAsset = await this.getSwapAsset(targetAsset.blockchain, swapAssetName);

    const sellLiquidity = await this.resolveSwapLiquidity(correlationId.toString(), targetAsset, minAmount, maxAmount);

    order.inputAmount = sellLiquidity.amount;
    order.inputAsset = sellLiquidity.asset.name;

    const request = {
      context: LiquidityOrderContext.LIQUIDITY_MANAGEMENT,
      correlationId: correlationId.toString(),
      referenceAsset: sellLiquidity.asset,
      referenceAmount: sellLiquidity.amount,
      targetAsset: swapAsset,
    };

    await this.dexService.purchaseLiquidity(request);

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

  private async checkSwapCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    try {
      const result = await this.dexService.checkOrderReady(
        LiquidityOrderContext.LIQUIDITY_MANAGEMENT,
        order.correlationId,
      );

      if (result.isReady) {
        await this.dexService.completeOrders(LiquidityOrderContext.LIQUIDITY_MANAGEMENT, order.correlationId);

        order.outputAmount = result.targetAmount;
        order.outputAsset = result.targetAsset;
      }

      return result.isReady;
    } catch (e) {
      throw new OrderFailedException(e.message);
    }
  }

  private async checkWithdrawCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const { system, assetId, exchangeAssetName } = this.parseWithdrawParams(order.action.paramMap);

    const exchange = this.exchangeRegistry.get(system);

    const sourceAsset = assetId ? await this.assetService.getAssetById(assetId) : undefined;
    const sourceChain = sourceAsset && exchange.mapNetwork(sourceAsset.blockchain);

    const targetAsset = order.pipeline.rule.targetAsset;
    const depositAssetName = exchangeAssetName ?? targetAsset.dexName;

    const deposits = await exchange.getDeposits(depositAssetName, order.created, sourceChain || undefined);
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
    exchangeAssetName?: string;
  } {
    const address = process.env[params.destinationAddress as string];
    const system = params.destinationSystem as LiquidityManagementSystem;
    const assetId = params.assetId as number | undefined;
    const exchangeAssetName = params.exchangeAssetName as string | undefined;

    const isValid = this.withdrawParamsValid(address, system);
    if (!isValid) throw new Error(`Params provided to DfxDexAdapter.withdraw(...) command are invalid.`);

    return { address, system, assetId, exchangeAssetName };
  }

  private withdrawParamsValid(address: string, system: LiquidityManagementSystem): boolean {
    return !!(
      address &&
      system &&
      Object.values(LiquidityManagementSystem).includes(system) &&
      this.exchangeRegistry.get(system)
    );
  }

  private validateSwapParams(params: Record<string, unknown>): boolean {
    try {
      this.parseSwapParams(params);
      return true;
    } catch {
      return false;
    }
  }

  private parseSwapParams(params: Record<string, unknown>): { swapAsset: string } {
    const swapAsset = params?.tradeAsset as string | undefined;

    if (!(typeof swapAsset === 'string' && swapAsset.length > 0))
      throw new Error('Params provided to DfxDexAdapter swap command are invalid.');

    return { swapAsset };
  }

  // --- SWAP HELPERS --- //

  private async resolveSwapLiquidity(
    correlationId: string,
    liquidityAsset: Asset,
    minAmount: number,
    maxAmount: number,
  ): Promise<{ asset: Asset; amount: number }> {
    // Check available liquidity
    const checkRequest = {
      context: LiquidityOrderContext.LIQUIDITY_MANAGEMENT,
      correlationId,
      referenceAsset: liquidityAsset,
      referenceAmount: minAmount,
      targetAsset: liquidityAsset,
    };

    const {
      reference: { availableAmount },
    } = await this.dexService.checkLiquidity(checkRequest);

    if (availableAmount < minAmount) {
      throw new OrderNotProcessableException(
        `Not enough ${liquidityAsset.name} liquidity (balance: ${availableAmount}, min. requested: ${minAmount}, max. requested: ${maxAmount})`,
      );
    }

    const amount = Math.min(maxAmount, availableAmount);

    return { asset: liquidityAsset, amount };
  }

  private async getSwapAsset(blockchain: Blockchain, swapAssetName: string): Promise<Asset> {
    const swapAsset = await this.assetService.getAssetByQuery({
      name: swapAssetName,
      blockchain,
      type: AssetType.TOKEN,
    });

    if (!swapAsset) {
      throw new OrderNotProcessableException(`Swap asset ${swapAssetName} not found on ${blockchain}`);
    }

    return swapAsset;
  }
}
