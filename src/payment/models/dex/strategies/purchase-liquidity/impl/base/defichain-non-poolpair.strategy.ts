import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { AssetCategory } from 'src/shared/models/asset/asset.entity';
import { MailService } from 'src/shared/services/mail.service';
import { LiquidityOrder } from '../../../../entities/liquidity-order.entity';
import { NotEnoughLiquidityException } from '../../../../exceptions/not-enough-liquidity.exception';
import { LiquidityOrderFactory } from '../../../../factories/liquidity-order.factory';
import { LiquidityRequest } from '../../../../interfaces';
import { LiquidityOrderRepository } from '../../../../repositories/liquidity-order.repository';
import { DexDeFiChainService } from '../../../../services/dex-defichain.service';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';

export abstract class DeFiChainNonPoolPairStrategy extends PurchaseLiquidityStrategy {
  private prioritySwapAssets: string[] = [];

  constructor(
    mailService: MailService,
    protected readonly dexDeFiChainService: DexDeFiChainService,
    protected readonly liquidityOrderRepo: LiquidityOrderRepository,
    protected readonly liquidityOrderFactory: LiquidityOrderFactory,
    prioritySwapAssets: string[],
  ) {
    super(mailService);
    this.prioritySwapAssets = prioritySwapAssets;
  }

  async purchaseLiquidity(request: LiquidityRequest): Promise<void> {
    const order = this.liquidityOrderFactory.createPurchaseOrder(request, Blockchain.DEFICHAIN, AssetCategory.STOCK);

    try {
      await this.bookLiquiditySwap(order);
      await this.liquidityOrderRepo.save(order);
    } catch (e) {
      await this.handlePurchaseLiquidityError(e, request);
    }
  }

  private async bookLiquiditySwap(order: LiquidityOrder): Promise<void> {
    const { referenceAsset, referenceAmount, targetAsset, maxPriceSlippage } = order;

    const { asset: swapAsset, amount: swapAmount } = await this.getSuitableSwapAsset(
      referenceAsset,
      referenceAmount,
      targetAsset.dexName,
    );

    const txId = await this.dexDeFiChainService.purchaseLiquidity(
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

    for (const prioritySwapAsset of this.prioritySwapAssets) {
      if (!(targetAsset === 'DUSD' && prioritySwapAsset === 'DUSD')) {
        try {
          return {
            asset: prioritySwapAsset,
            amount: await this.dexDeFiChainService.getSwapAmountForPurchase(
              referenceAsset,
              referenceAmount,
              targetAsset,
              prioritySwapAsset,
            ),
          };
        } catch (e) {
          if (e instanceof NotEnoughLiquidityException) {
            errors.push(e.message);
          } else {
            throw e;
          }
        }
      }
    }

    throw new NotEnoughLiquidityException(
      `Failed to find suitable source asset for liquidity order (target asset ${targetAsset}). `.concat(...errors),
    );
  }
}
