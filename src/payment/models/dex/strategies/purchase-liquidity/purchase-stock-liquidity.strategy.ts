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
import { Blockchain } from 'src/ain/node/node.service';

@Injectable()
export class PurchaseStockLiquidityStrategy extends PurchaseLiquidityStrategy {
  constructor(
    readonly mailService: MailService,
    private readonly liquidityService: LiquidityService,
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    private readonly liquidityOrderFactory: LiquidityOrderFactory,
  ) {
    super(mailService);
  }

  async purchaseLiquidity(request: LiquidityRequest): Promise<void> {
    const order = this.liquidityOrderFactory.createPurchaseOrder(request, Blockchain.DEFICHAIN, AssetCategory.STOCK);

    try {
      await this.bookLiquiditySwap(order);
      await this.liquidityOrderRepo.save(order);
    } catch (e) {
      await this.handlePurchaseLiquidityError(e, order);
    }
  }

  private async bookLiquiditySwap(order: LiquidityOrder): Promise<void> {
    const { referenceAsset, referenceAmount, targetAsset, maxPriceSlippage } = order;

    const { asset: swapAsset, amount: swapAmount } = await this.getSuitableSwapAsset(
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

    console.info(
      `Booked purchase of ${swapAmount} ${swapAsset} worth liquidity for asset ${order.targetAsset.dexName}. Context: ${order.context}. CorrelationId: ${order.correlationId}.`,
    );

    order.addPurchaseMetadata(txId, swapAsset, swapAmount);
  }

  private async getSuitableSwapAsset(
    referenceAsset: string,
    referenceAmount: number,
    targetAsset: string,
  ): Promise<{ asset: string; amount: number }> {
    const errors = [];

    if (targetAsset !== 'DUSD') {
      try {
        const amount = await this.liquidityService.getSwapAmountForPurchase(
          referenceAsset,
          referenceAmount,
          targetAsset,
          'DUSD',
        );
        return { asset: 'DUSD', amount };
      } catch (e) {
        if (e instanceof NotEnoughLiquidityException) {
          errors.push(e.message);
        } else {
          throw e;
        }
      }
    }

    try {
      const amount = await this.liquidityService.getSwapAmountForPurchase(
        referenceAsset,
        referenceAmount,
        targetAsset,
        'DFI',
      );

      return { asset: 'DFI', amount };
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
