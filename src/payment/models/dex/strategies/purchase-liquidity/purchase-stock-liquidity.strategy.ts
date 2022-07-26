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
export class PurchaseStockLiquidityStrategy extends PurchaseLiquidityStrategy {
  constructor(
    readonly mailService: MailService,
    private readonly liquidityOrderFactory: LiquidityOrderFactory,
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    private readonly liquidityService: LiquidityService,
  ) {
    super(mailService);
  }

  async purchaseLiquidity(request: LiquidityRequest): Promise<void> {
    const order = this.liquidityOrderFactory.createPurchaseOrder(request, 'defichain', AssetCategory.STOCK);

    try {
      const chainSwapId = await this.bookLiquiditySwap(order);

      order.addPurchaseTxId(chainSwapId);

      await this.liquidityOrderRepo.save(order);
    } catch (e) {
      this.handlePurchaseLiquidityError(e, order);
    }
  }

  private async bookLiquiditySwap(order: LiquidityOrder): Promise<string> {
    const { referenceAsset, referenceAmount, targetAsset, maxPriceSlippage } = order;

    const { asset: sourceAsset, amount: sourceAmount } = await this.getSuitableSwapAsset(
      referenceAsset,
      referenceAmount,
      targetAsset.dexName,
    );

    const txId = await this.liquidityService.purchaseLiquidity(
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

  private async getSuitableSwapAsset(
    referenceAsset: string,
    referenceAmount: number,
    targetAsset: string,
  ): Promise<{ asset: string; amount: number }> {
    const errors = [];

    try {
      return {
        asset: 'DUSD',
        amount: await this.liquidityService.getSwapAmountForPurchase(
          referenceAsset,
          referenceAmount,
          targetAsset,
          'DUSD',
        ),
      };
    } catch (e) {
      if (e instanceof NotEnoughLiquidityException) {
        errors.push(e.message);
      } else {
        throw e;
      }
    }

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
        errors.push(e.message);
      } else {
        throw e;
      }
    }

    throw new NotEnoughLiquidityException(
      'Failed to find suitable source asset for liquidity order. '.concat(...errors),
    );
  }
}
