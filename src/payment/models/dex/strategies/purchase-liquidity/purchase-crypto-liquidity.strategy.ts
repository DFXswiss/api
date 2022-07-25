import { Injectable } from '@nestjs/common';
import { LiquidityOrder } from '../../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../../repositories/liquidity-order.repository';
import { SwapLiquidityService } from '../../services/swap-liquidity.service';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';
import { MailService } from 'src/shared/services/mail.service';
import { LiquidityOrderFactory } from '../../factories/liquidity-order.factory';
import { LiquidityRequest } from '../../services/dex.service';
import { AssetNotAvailableException } from '../../exceptions/asset-not-available.exception';
import { AssetCategory } from 'src/shared/models/asset/asset.entity';

@Injectable()
export class PurchaseCryptoLiquidityStrategy extends PurchaseLiquidityStrategy {
  constructor(
    readonly mailService: MailService,
    private readonly liquidityOrderFactory: LiquidityOrderFactory,
    private readonly swapLiquidityService: SwapLiquidityService,
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
  ) {
    super(mailService);
  }

  async purchaseLiquidity(request: LiquidityRequest): Promise<void> {
    const order = this.liquidityOrderFactory.createFromRequest(request, 'defichain', AssetCategory.CRYPTO);

    try {
      const chainSwapId = await this.bookLiquiditySwap(order);

      order.addChainSwapId(chainSwapId);

      await this.liquidityOrderRepo.save(order);
    } catch (e) {
      this.handlePurchaseLiquidityError(e, order);
    }
  }

  private async bookLiquiditySwap(order: LiquidityOrder): Promise<string> {
    const { referenceAsset, referenceAmount, targetAsset, maxPriceSlippage } = order;
    const { asset: sourceAsset, amount: sourceAmount } = await this.getSourceAsset(referenceAsset, referenceAmount);

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

  private async getSourceAsset(
    referenceAsset: string,
    referenceAmount: number,
  ): Promise<{ asset: string; amount: number }> {
    try {
      return await this.swapLiquidityService.tryAssetAvailability(referenceAsset, referenceAmount, 'DFI');
    } catch (e) {
      if (this.swapLiquidityService.isAssetNotAvailableError(e)) {
        throw new AssetNotAvailableException(
          `Failed to find suitable source asset for liquidity order. `.concat(e.message),
        );
      }

      throw e;
    }
  }
}
