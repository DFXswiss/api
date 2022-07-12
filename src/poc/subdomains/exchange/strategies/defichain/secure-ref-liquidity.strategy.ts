import { Injectable } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { SecureLiquidityCommand } from '../commands/secure-liquidity.command';
import { LiquiditySecuredEvent } from '../events/liquidity-secured.event';
import { DefichainDexLiquidityService } from '../services/defichain/defichain-dex-liquidity.service';
import { DefichainReferenceAssetService } from '../services/defichain/reference-asset.service';
import { SecureLiquidityStrategy } from './secure-liquidity.strategy';

@Injectable()
export class SecureReferenceAssetLiquidityStrategy extends SecureLiquidityStrategy {
  constructor(
    private readonly eventBus: EventBus,
    private readonly defichainDexLiquidityService: DefichainDexLiquidityService,
    private readonly defichainReferenceAssetService: DefichainReferenceAssetService,
  ) {
    super();
  }

  async secureLiquidity(command: SecureLiquidityCommand): Promise<void> {
    const liquidity = await this.defichainDexLiquidityService.checkLiquidity(command.payload);

    if (liquidity !== 0) {
      this.eventBus.publish(
        new LiquiditySecuredEvent(command.correlationId, {
          securedAsset: command.payload.targetAsset,
          securedAmount: liquidity,
        }),
      );

      console.info(`SecureLiquidityCommand processed. Command ID: ${command.id}`);
    }

    const swapRequest = { amount: command.payload.referenceAmount, asset: command.payload.referenceAsset };
    const swapAmount = await this.defichainReferenceAssetService.calculateLiquiditySwapAmount(swapRequest);
    await this.defichainDexLiquidityService.purchaseLiquidity(swapAmount, command.payload.targetAsset);
    // now loop and wait for saved tx to complete in order to send LiquiditySecuredEvent
  }
}
