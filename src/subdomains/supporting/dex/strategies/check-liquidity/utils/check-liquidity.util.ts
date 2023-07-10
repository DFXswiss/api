import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { CheckLiquidityRequest, CheckLiquidityResult, LiquidityResult } from '../../../interfaces';

export class CheckLiquidityUtil {
  // --- RESULTS --- //
  static createNonPurchasableCheckLiquidityResult(
    request: CheckLiquidityRequest,
    targetAmount: number,
    availableAmount: number,
    feeAsset: Asset,
    referenceMaxPurchasableAmount = 0,
  ): CheckLiquidityResult {
    const { referenceAsset, referenceAmount, targetAsset } = request;
    const targetAvailableAmount = availableAmount > 0 ? availableAmount : 0;

    const referenceAvailableAmount =
      targetAmount > 0 ? Util.round((targetAvailableAmount / targetAmount) * referenceAmount, 8) : 0;

    return {
      target: {
        asset: targetAsset,
        amount: targetAmount,
        availableAmount: targetAvailableAmount,
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
        isEnoughAvailableLiquidity: availableAmount >= targetAmount,
        isSlippageDetected: false,
        slippageMessage: 'no slippage detected',
      },
    };
  }

  static createCheckLiquidityResult(
    request: CheckLiquidityRequest,
    liquidity: LiquidityResult,
    feeAsset: Asset,
  ): CheckLiquidityResult {
    const { referenceAsset, referenceAmount, targetAsset } = request;
    const { targetAmount, availableAmount, maxPurchasableAmount, isSlippageDetected, slippageMessage, feeAmount } =
      liquidity;

    const targetAvailableAmount = Math.max(availableAmount, 0);
    const targetMaxPurchasableAmount = Math.max(maxPurchasableAmount, 0);

    // indicative calculation, doesn't have to be 100% precise (no test swap required)
    const referenceAvailableAmount = Util.round((targetAvailableAmount / targetAmount) * referenceAmount, 8);
    const referenceMaxPurchasableAmount = Util.round((targetMaxPurchasableAmount / targetAmount) * referenceAmount, 8);

    return {
      target: {
        asset: targetAsset,
        amount: targetAmount,
        availableAmount: targetAvailableAmount,
        maxPurchasableAmount: targetMaxPurchasableAmount,
      },
      reference: {
        asset: referenceAsset,
        amount: referenceAmount,
        availableAmount: referenceAvailableAmount,
        maxPurchasableAmount: referenceMaxPurchasableAmount,
      },
      purchaseFee: {
        asset: feeAsset,
        amount: feeAmount,
      },
      metadata: {
        isEnoughAvailableLiquidity: availableAmount > targetAmount,
        isSlippageDetected,
        slippageMessage,
      },
    };
  }

  // --- SLIPPAGE --- //

  static checkSlippage(
    price: number,
    maxSlippage: number,
    sourceAmount: number,
    targetAmount: number,
    sourceAsset: Asset,
    targetAsset: Asset,
  ): [boolean, string] {
    const maxPrice = CheckLiquidityUtil.getMaxPrice(price, maxSlippage);

    const minimalAllowedTargetAmount = Util.round(sourceAmount / maxPrice, 8);

    const isSlippageDetected = targetAmount > 0.000001 && targetAmount < minimalAllowedTargetAmount;
    const slippageMessage = CheckLiquidityUtil.generateSlippageMessage(
      isSlippageDetected,
      sourceAsset,
      sourceAmount,
      targetAsset,
      targetAmount,
      maxPrice,
    );

    return [isSlippageDetected, slippageMessage];
  }

  static getMaxPrice(price: number, maxSlippage: number): number {
    return Util.round(price * (1 + maxSlippage), 8);
  }

  static generateSlippageMessage(
    isSlippageDetected: boolean,
    sourceAsset: Asset,
    sourceAmount: number,
    targetAsset: Asset,
    targetAmount: number,
    maxPrice: number,
  ) {
    const actualPrice = Util.round(sourceAmount / targetAmount, 8);

    return isSlippageDetected
      ? `Price is higher than indicated. Test swap ${sourceAmount} ${sourceAsset.dexName} to ${targetAmount} ${targetAsset.dexName}. Maximum price for asset ${targetAsset.dexName} is ${maxPrice} ${sourceAsset.dexName}. Actual price is ${actualPrice} ${sourceAsset.dexName}`
      : 'no slippage detected';
  }
}
