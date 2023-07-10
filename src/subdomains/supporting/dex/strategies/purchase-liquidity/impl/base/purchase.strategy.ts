import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { ChainSwapId, LiquidityOrder } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { NotEnoughLiquidityException } from 'src/subdomains/supporting/dex/exceptions/not-enough-liquidity.exception';
import { PurchaseLiquidityRequest } from '../../../../interfaces';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';

export interface PurchaseDexService {
  calculatePrice(sourceAsset: Asset, targetAsset: Asset): Promise<number>;
  getAssetAvailability(asset: Asset): Promise<number>;
  getTargetAmount(referenceAsset: Asset, referenceAmount: number, targetAsset: Asset): Promise<number>;
  swap(swapAsset: Asset, swapAmount: number, targetAsset: Asset, maxPriceSlippage: number): Promise<ChainSwapId>;
  getSwapResult(txId: string, asset: Asset): Promise<{ targetAmount: number; feeAmount: number }>;
}

export abstract class PurchaseStrategy extends PurchaseLiquidityStrategy {
  constructor(
    protected readonly dexService: PurchaseDexService,
    swapAssetDescriptors: { name: string; type: AssetType }[],
  ) {
    super(swapAssetDescriptors);
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

    const { asset: swapAsset, amount: swapAmount } = await this.getSuitableSwapAssetName(
      referenceAsset,
      referenceAmount,
      targetAsset,
    );

    const txId = await this.dexService.swap(swapAsset, swapAmount, targetAsset, maxPriceSlippage);

    this.logger.verbose(
      `Booked purchase of ${swapAmount} ${swapAsset.dexName} worth liquidity for asset ${order.targetAsset.dexName}. Context: ${order.context}. CorrelationId: ${order.correlationId}.`,
    );

    order.addBlockchainTransactionMetadata(txId, swapAsset, swapAmount);
  }

  private async getSuitableSwapAssetName(
    referenceAsset: Asset,
    referenceAmount: number,
    targetAsset: Asset,
  ): Promise<{ asset: Asset; amount: number }> {
    const errors = [];

    for (const prioritySwapAsset of await this.swapAssets()) {
      if (!(targetAsset.dexName === 'DUSD' && prioritySwapAsset.dexName === 'DUSD')) {
        try {
          return {
            asset: prioritySwapAsset,
            amount: await this.getSwapAmountForPurchase(
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
      `Failed to find suitable source asset for liquidity order (target asset ${targetAsset.dexName}). `.concat(
        ...errors,
      ),
    );
  }

  private async getSwapAmountForPurchase(
    referenceAsset: Asset,
    referenceAmount: number,
    targetAsset: Asset,
    swapAsset: Asset,
  ): Promise<number> {
    const swapAmount = await this.calculateSwapAmountForPurchase(
      referenceAsset,
      referenceAmount,
      swapAsset,
      targetAsset,
    );

    await this.checkAssetAvailability(swapAsset, swapAmount);

    return swapAmount;
  }

  private async calculateSwapAmountForPurchase(
    referenceAsset: Asset,
    referenceAmount: number,
    swapAsset: Asset,
    targetAsset?: Asset,
  ): Promise<number> {
    if (referenceAsset.id === targetAsset?.id) {
      const swapAssetPrice = await this.dexService.calculatePrice(swapAsset, referenceAsset);

      const swapAmount = referenceAmount * swapAssetPrice;

      // adding 5% cap to liquidity swap to cover meantime referenceAmount price difference (initially taken from Kraken/Binance)
      return Util.round(swapAmount + swapAmount * 0.05, 8);
    }

    return this.dexService.getTargetAmount(referenceAsset, referenceAmount, swapAsset);
  }

  private async estimateTargetAmount(order: LiquidityOrder): Promise<void> {
    const { referenceAsset, referenceAmount, targetAsset } = order;

    const estimatedTargetAmount = await this.dexService.getTargetAmount(referenceAsset, referenceAmount, targetAsset);

    order.addEstimatedTargetAmount(estimatedTargetAmount);
  }

  private async checkAssetAvailability(asset: Asset, requiredAmount: number): Promise<void> {
    const availableAmount = await this.dexService.getAssetAvailability(asset);

    if (requiredAmount > availableAmount) {
      throw new NotEnoughLiquidityException(
        `Not enough liquidity of asset ${asset.dexName}. Trying to use ${requiredAmount} ${asset.dexName} worth liquidity. Available amount: ${availableAmount}.`,
      );
    }
  }
}
