import { Injectable } from '@nestjs/common';
import { LiquidityOrder } from '../../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../../repositories/liquidity-order.repository';
import { BuyCryptoNotificationService } from '../../../buy-crypto/services/buy-crypto-notification.service';
import { SwapLiquidityService } from '../../services/swap-liquidity.service';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';

@Injectable()
export class PurchaseCryptoLiquidityStrategy implements PurchaseLiquidityStrategy {
  constructor(
    private readonly buyCryptoNotificationService: BuyCryptoNotificationService,
    private readonly swapLiquidityService: SwapLiquidityService,
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
  ) {}

  async purchaseLiquidity(order: LiquidityOrder): Promise<void> {
    const chainSwapId = await this.bookLiquiditySwap(order);

    order.addChainSwapId(chainSwapId);

    await this.liquidityOrderRepo.save(order);
  }

  private async bookLiquiditySwap(order: LiquidityOrder): Promise<string> {
    const { referenceAsset, referenceAmount, targetAsset, maxPriceSlippage } = order;
    const { asset: sourceAsset, amount: sourceAmount } = await this.swapLiquidityService.tryAssetAvailability(
      referenceAsset,
      referenceAmount,
      'DFI',
    );

    const txId = await this.swapLiquidityService.doAssetSwap(
      sourceAsset,
      sourceAmount,
      targetAsset.dexName,
      maxPriceSlippage,
    );

    console.info(
      `Booked ${sourceAmount} ${sourceAsset} worth liquidity for asset ${order.targetAsset.dexName}. Context: ${order.context}. CorrelationId: ${order.correlationId}.`,
    );

    return txId;
  }
}
