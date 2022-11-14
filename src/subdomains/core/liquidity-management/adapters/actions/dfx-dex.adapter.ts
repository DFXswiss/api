import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityManagementOrder } from '../../entities/liquidity-management-order.entity';
import { CorrelationId, LiquidityActionIntegration } from '../../interfaces';

@Injectable()
export class DfxDexAdapter implements LiquidityActionIntegration {
  private commands = new Map<string, (asset: Asset, amount: number, correlationId: number) => Promise<CorrelationId>>();

  private _supportedCommands: string[];

  constructor(private readonly dexService: DexService) {
    this.commands.set('purchase', this.purchase.bind(this));

    this._supportedCommands = [...this.commands.keys()];
  }

  async runCommand(command: string, order: LiquidityManagementOrder): Promise<CorrelationId> {
    const {
      pipeline: {
        rule: { target: asset },
      },
      amount,
    } = order;

    if (!(asset instanceof Asset)) {
      throw new Error('DfxDexAdapter supports only Assets.');
    }

    return this.commands.get(command)(asset, amount, order.id);
  }

  async checkCompletion(correlationId: CorrelationId): Promise<boolean> {
    const result = await this.dexService.checkOrderReady(LiquidityOrderContext.LIQUIDITY_MANAGEMENT, correlationId);
    if (result.isReady) await this.dexService.completeOrders(LiquidityOrderContext.LIQUIDITY_MANAGEMENT, correlationId);

    return result.isReady;
  }

  //*** COMMANDS IMPLEMENTATIONS ***//

  private async purchase(asset: Asset, amount: number, correlationId: number): Promise<CorrelationId> {
    const request = {
      context: LiquidityOrderContext.LIQUIDITY_MANAGEMENT,
      correlationId: correlationId.toString(),
      referenceAsset: asset,
      referenceAmount: amount,
      targetAsset: asset,
    };

    await this.dexService.purchaseLiquidity(request);

    return null;
  }

  get supportedCommands(): string[] {
    return [...this._supportedCommands];
  }
}
