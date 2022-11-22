import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { CheckLiquidityRequest, CheckLiquidityResult } from '../../../interfaces';

export class CheckLiquidityUtil {
  static createNonPurchasableCheckLiquidityResult(
    request: CheckLiquidityRequest,
    targetAmount: number,
    availableAmount: number,
    feeAsset: Asset,
    referenceMaxPurchasableAmount = 0,
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
        maxPurchasableAmount: referenceMaxPurchasableAmount,
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
