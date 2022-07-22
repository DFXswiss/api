import { Injectable } from '@nestjs/common';
import { LiquidityOrder } from '../../entities/liquidity-order.entity';
import { AssetNotAvailableException } from '../../exceptions/asset-not-available.exception';
import { LiquidityOrderRepository } from '../../repositories/liquidity-order.repository';
import { SwapLiquidityService } from '../../services/swap-liquidity.service';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';
import { MailService } from 'src/shared/services/mail.service';
import { LiquidityOrderFactory } from '../../factories/liquidity-order.factory';
import { PurchaseLiquidityRequest } from './purchase-liquidity.facade';

@Injectable()
export class PurchaseStockLiquidityStrategy extends PurchaseLiquidityStrategy {
  constructor(
    readonly mailService: MailService,
    private readonly liquidityOrderFactory: LiquidityOrderFactory,
    private readonly swapLiquidityService: SwapLiquidityService,
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
  ) {
    super(mailService);
  }

  async purchaseLiquidity(request: PurchaseLiquidityRequest): Promise<void> {
    const order = this.liquidityOrderFactory.createFromRequest(request, 'defichain');

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
