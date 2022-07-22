import { Injectable } from '@nestjs/common';
import { LiquidityOrder } from '../../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../../repositories/liquidity-order.repository';
import { SwapLiquidityService } from '../../services/swap-liquidity.service';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';
import { AssetNotAvailableException } from 'src/payment/models/dex/exceptions/asset-not-available.exception';
import { MailService } from 'src/shared/services/mail.service';
import { LiquidityOrderFactory } from '../../factories/liquidity-order.factory';
import { PurchaseLiquidityRequest } from './purchase-liquidity.facade';

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

  protected async handlePurchaseLiquidityError(e: Error, order: LiquidityOrder): Promise<void> {
    const errorMessage = `LiquidityOrder ID: ${order.id}. ${e.message}`;

    if (e instanceof AssetNotAvailableException) {
      await this.mailService.sendErrorMail('Purchase Liquidity Error', [errorMessage]);
    }

    throw new Error(errorMessage);
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
