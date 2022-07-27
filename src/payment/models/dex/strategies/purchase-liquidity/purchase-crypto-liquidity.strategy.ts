import { Injectable } from '@nestjs/common';
import { LiquidityOrder } from '../../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../../repositories/liquidity-order.repository';
import { LiquidityService } from '../../services/liquidity.service';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';
import { MailService } from 'src/shared/services/mail.service';
import { LiquidityOrderFactory } from '../../factories/liquidity-order.factory';
import { LiquidityRequest } from '../../services/dex.service';
import { AssetCategory } from 'src/shared/models/asset/asset.entity';
import { NotEnoughLiquidityException } from '../../exceptions/not-enough-liquidity.exception';

@Injectable()
export class PurchaseCryptoLiquidityStrategy extends PurchaseLiquidityStrategy {
  constructor(
    readonly mailService: MailService,
    private readonly liquidityService: LiquidityService,
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    private readonly liquidityOrderFactory: LiquidityOrderFactory,
  ) {
    super(mailService);
  }

  async purchaseLiquidity(request: LiquidityRequest): Promise<void> {
    const order = this.liquidityOrderFactory.createPurchaseOrder(request, 'defichain', AssetCategory.CRYPTO);

    try {
      await this.bookLiquiditySwap(order);
      await this.liquidityOrderRepo.save(order);
    } catch (e) {
      await this.handlePurchaseLiquidityError(e, order);
    }
  }

  private async bookLiquiditySwap(order: LiquidityOrder): Promise<void> {
    const { referenceAsset, referenceAmount, targetAsset, maxPriceSlippage } = order;

    const { asset: swapAsset, amount: swapAmount } = await this.getSwapAsset(
      referenceAsset,
      referenceAmount,
      targetAsset.dexName,
    );

    const txId = await this.liquidityService.purchaseLiquidity(
      swapAsset,
      swapAmount,
      targetAsset.dexName,
      maxPriceSlippage,
    );

    order.addPurchaseMetadata(txId, swapAsset, swapAmount);

    console.info(
      `Booked purchase of ${swapAmount} ${swapAsset} worth liquidity for asset ${order.targetAsset.dexName}. Context: ${order.context}. CorrelationId: ${order.correlationId}.`,
    );
  }

  private async getSwapAsset(
    referenceAsset: string,
    referenceAmount: number,
    targetAsset: string,
  ): Promise<{ asset: string; amount: number }> {
    try {
      return {
        asset: 'DFI',
        amount: await this.liquidityService.getSwapAmountForPurchase(
          referenceAsset,
          referenceAmount,
          targetAsset,
          'DFI',
        ),
      };
    } catch (e) {
      if (e instanceof NotEnoughLiquidityException) {
        throw new NotEnoughLiquidityException(
          'Failed to find suitable source asset for liquidity order. '.concat(e.message),
        );
      }

      throw e;
    }
  }
}
