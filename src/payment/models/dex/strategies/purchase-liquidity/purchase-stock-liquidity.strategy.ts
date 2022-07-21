import { Injectable } from '@nestjs/common';
import { LiquidityOrder } from '../../entities/liquidity-order.entity';
import { AssetNotAvailableException } from '../../../buy-crypto/exceptions/asset-not-available.exception';
import { LiquidityOrderRepository } from '../../repositories/liquidity-order.repository';
import { BuyCryptoNotificationService } from '../../../buy-crypto/services/buy-crypto-notification.service';
import { SwapLiquidityService } from '../../services/swap-liquidity.service';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';

@Injectable()
export class PurchaseStockLiquidityStrategy implements PurchaseLiquidityStrategy {
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

    try {
      const { asset: sourceAsset, amount: sourceAmount } = await this.getSuitableSourceAsset(
        referenceAsset,
        referenceAmount,
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
    } catch (e) {
      const errorMessage = `LiquidityOrder  ID: ${order.id}. ${e.message}`;
      console.error(errorMessage);

      if (e instanceof AssetNotAvailableException) {
        await this.buyCryptoNotificationService.sendNonRecoverableErrorMail(errorMessage);
      }

      throw e;
    }
  }

  private async getSuitableSourceAsset(
    referenceAsset: string,
    referenceAmount: number,
  ): Promise<{ asset: string; amount: number }> {
    const errors = [];

    try {
      return await this.swapLiquidityService.tryAssetAvailability(referenceAsset, referenceAmount, 'DUSD');
    } catch (e) {
      errors.push(e.message);
    }

    try {
      return await this.swapLiquidityService.tryAssetAvailability(referenceAsset, referenceAmount, 'DFI');
    } catch (e) {
      errors.push(e.message);
    }

    throw new AssetNotAvailableException(
      `Failed to find suitable source asset for liquidity order. `.concat(...errors),
    );
  }
}
