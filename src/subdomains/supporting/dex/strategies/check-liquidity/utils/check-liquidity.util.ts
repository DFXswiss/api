import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { CheckLiquidityResult, LiquidityRequest } from '../../../interfaces';

export class CheckLiquidityUtil {
  static createNonPurchasableCheckLiquidityResult(
    request: LiquidityRequest,
    targetAmount: number,
    availableAmount: number,
    feeAsset: Asset,
  ): CheckLiquidityResult {
    const { referenceAsset, referenceAmount, targetAsset } = request;
    const referenceAvailableAmount = targetAmount
      ? Util.round((availableAmount / targetAmount) * referenceAmount, 8)
      : 0;

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
        availableAmount: referenceAvailableAmount,
        maxPurchasableAmount: 0,
      },
      purchaseFee: {
        asset: feeAsset,
        amount: 0,
      },
      metadata: {
        isEnoughAvailableLiquidity: availableAmount > targetAmount,
        isSlippageDetected: false,
        slippageMessage: 'no slippage detected',
      },
    };
  }
}
