import { Asset } from 'src/shared/models/asset/asset.entity';
import { CheckLiquidityResult, LiquidityRequest } from '../../../interfaces';

export class CheckLiquidityUtil {
  static createNonPurchasableCheckLiquidityResult(
    request: LiquidityRequest,
    targetAmount: number,
    availableAmount: number,
    feeAsset: Asset,
  ): CheckLiquidityResult {
    const { referenceAsset, referenceAmount, targetAsset } = request;

    return {
      target: {
        asset: targetAsset,
        amount: targetAmount,
        availableAmount,
        maxPurchasableAmount: 0,
      },
      reference: {
        asset: referenceAsset,
        amount: referenceAmount,
        availableAmount: targetAmount ? (availableAmount / targetAmount) * referenceAmount : 0,
        maxPurchasableAmount: 0,
      },
      purchaseFee: {
        asset: feeAsset,
        amount: 0,
      },
      metadata: {
        isEnoughLiquidity: availableAmount > targetAmount * 1.05,
        isSlippageDetected: false,
      },
    };
  }
}
