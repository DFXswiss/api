import { Asset } from 'src/shared/models/asset/asset.entity';
import { ChainSwapId, LiquidityOrder } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { PurchaseLiquidityRequest } from '../../../../interfaces';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';

export interface PurchaseDexService {
  getTargetAmount(referenceAsset: Asset, referenceAmount: number, targetAsset: Asset): Promise<number>;
  swap(swapAsset: Asset, swapAmount: number, targetAsset: Asset, maxPriceSlippage: number): Promise<ChainSwapId>;
  getSwapResult(txId: string, asset: Asset): Promise<{ targetAmount: number; feeAmount: number }>;
}

export abstract class PurchaseStrategy extends PurchaseLiquidityStrategy {
  constructor(protected readonly dexService: PurchaseDexService) {
    super();
  }

  //*** PUBLIC API ***//

  async purchaseLiquidity(request: PurchaseLiquidityRequest): Promise<void> {
    const order = this.liquidityOrderFactory.createPurchaseOrder(request, this.blockchain, this.constructor.name);

    try {
      await this.bookLiquiditySwap(order);
      await this.estimateTargetAmount(order);

      await this.liquidityOrderRepo.save(order);
    } catch (e) {
      await this.handlePurchaseLiquidityError(e, request);
    }
  }

  async addPurchaseData(order: LiquidityOrder): Promise<void> {
    const { targetAmount, feeAmount } = await this.dexService.getSwapResult(order.txId, order.targetAsset);

    order.purchased(targetAmount);
    order.recordFee(await this.feeAsset(), feeAmount);
    await this.liquidityOrderRepo.save(order);
  }

  //*** HELPER METHODS ***//

  private async bookLiquiditySwap(order: LiquidityOrder): Promise<void> {
    const { referenceAsset, referenceAmount, targetAsset, maxPriceSlippage } = order;

    const txId = await this.dexService.swap(referenceAsset, referenceAmount, targetAsset, maxPriceSlippage);

    this.logger.verbose(
      `Booked purchase of ${referenceAmount} ${referenceAsset.dexName} worth liquidity for asset ${order.targetAsset.dexName}. Context: ${order.context}. CorrelationId: ${order.correlationId}.`,
    );

    order.addBlockchainTransactionMetadata(txId, referenceAsset, referenceAmount);
  }

  private async estimateTargetAmount(order: LiquidityOrder): Promise<void> {
    const { referenceAsset, referenceAmount, targetAsset } = order;

    const estimatedTargetAmount = await this.dexService.getTargetAmount(referenceAsset, referenceAmount, targetAsset);

    order.addEstimatedTargetAmount(estimatedTargetAmount);
  }
}
