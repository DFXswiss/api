import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityManagementOrder } from '../../entities/liquidity-management-order.entity';
import { OrderNotProcessableException } from '../../exceptions/order-not-processable.exception';
import { CorrelationId, LiquidityActionIntegration } from '../../interfaces';

@Injectable()
export class DfxDexAdapter implements LiquidityActionIntegration {
  private _supportedCommands: string[];
  private commands = new Map<string, (asset: Asset, amount: number, correlationId: number) => Promise<CorrelationId>>();

  constructor(private readonly dexService: DexService) {
    this.commands.set('purchase', this.purchase.bind(this));
    this.commands.set('sell', this.sell.bind(this));

    this._supportedCommands = [...this.commands.keys()];
  }

  /**
   * @note
   * Returned correlationId is ignored in case of DFX DEX. correlation is provided by client call (liquidity management)
   */
  async executeOrder(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const {
      action: { command },
      pipeline: {
        rule: { target: asset },
      },
      amount,
    } = order;

    if (!(asset instanceof Asset)) {
      throw new Error('DfxDexAdapter supports only Asset instances as an input');
    }

    try {
      return await this.commands.get(command)(asset, amount, order.id);
    } catch (e) {
      throw new OrderNotProcessableException(e.message);
    }
  }

  async checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
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

  //*** COMMANDS IMPLEMENTATIONS ***//

  /**
   * @note
   * correlationId is the orderId and set by liquidity management
   */
  private async purchase(asset: Asset, amount: number, correlationId: number): Promise<CorrelationId> {
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
  private async sell(asset: Asset, amount: number, correlationId: number): Promise<CorrelationId> {
    const request = {
      context: LiquidityOrderContext.LIQUIDITY_MANAGEMENT,
      correlationId: correlationId.toString(),
      sellAsset: asset,
      sellAmount: amount,
    };

    await this.dexService.sellLiquidity(request);

    return correlationId.toString();
  }

  get supportedCommands(): string[] {
    return [...this._supportedCommands];
  }
}
