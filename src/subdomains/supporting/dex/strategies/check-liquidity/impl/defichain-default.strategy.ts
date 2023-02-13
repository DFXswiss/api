import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrder } from '../../../entities/liquidity-order.entity';
import { CheckLiquidityRequest, CheckLiquidityResult } from '../../../interfaces';
import { DexDeFiChainLiquidityResult, DexDeFiChainService } from '../../../services/dex-defichain.service';
import { DeFiChainNonPoolPairStrategy } from '../../purchase-liquidity/impl/base/defichain-non-poolpair.strategy';
import { PurchaseLiquidityStrategies } from '../../purchase-liquidity/purchase-liquidity.facade';
import { CheckLiquidityStrategy } from './base/check-liquidity.strategy';

@Injectable()
export class DeFiChainDefaultStrategy extends CheckLiquidityStrategy {
  constructor(
    protected readonly assetService: AssetService,
    private readonly dexDeFiChainService: DexDeFiChainService,
    private readonly purchaseStrategies: PurchaseLiquidityStrategies,
  ) {
    super();
  }

  async checkLiquidity(request: CheckLiquidityRequest): Promise<CheckLiquidityResult> {
    const { referenceAsset, referenceAmount, targetAsset } = request;

    const prioritySwapAssets = await this.getPrioritySwapAssets(targetAsset);

    const liquidity = await this.dexDeFiChainService.getAndCheckAvailableTargetLiquidity(
      referenceAsset,
      referenceAmount,
      targetAsset,
      LiquidityOrder.getMaxPriceSlippage(targetAsset.dexName),
      prioritySwapAssets,
    );

    return this.createCheckLiquidityResult(request, liquidity);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getDfiCoin();
  }

  //*** HELPER METHODS ***/

  private async getPrioritySwapAssets(targetAsset: Asset): Promise<Asset[]> {
    try {
      const purchaseStrategy = this.purchaseStrategies.getPurchaseLiquidityStrategy(
        targetAsset,
      ) as DeFiChainNonPoolPairStrategy;

      if (!purchaseStrategy) return [];

      return await purchaseStrategy.getPrioritySwapAssets();
    } catch (e) {
      console.warn(
        `Error while getting priority assets from purchase liquidity strategy. Target asset: ${targetAsset.uniqueName}`,
      );

      return [];
    }
  }

  private async createCheckLiquidityResult(
    request: CheckLiquidityRequest,
    liquidity: DexDeFiChainLiquidityResult,
  ): Promise<CheckLiquidityResult> {
    const { referenceAsset, referenceAmount, targetAsset } = request;
    const { targetAmount, availableAmount, maxPurchasableAmount, isSlippageDetected, slippageMessage, feeAmount } =
      liquidity;

    const targetAvailableAmount = availableAmount > 0 ? availableAmount : 0;
    const targetMaxPurchasableAmount = maxPurchasableAmount > 0 ? maxPurchasableAmount : 0;

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
        asset: await this.feeAsset(),
        amount: feeAmount,
      },
      metadata: {
        isEnoughAvailableLiquidity: availableAmount > targetAmount,
        isSlippageDetected,
        slippageMessage,
      },
    };
  }
}
