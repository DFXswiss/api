import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityOrder } from '../../../entities/liquidity-order.entity';
import { CheckLiquidityResult, LiquidityRequest } from '../../../interfaces';
import { DexDeFiChainService } from '../../../services/dex-defichain.service';
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

  async checkLiquidity(request: LiquidityRequest): Promise<CheckLiquidityResult> {
    const { referenceAsset, referenceAmount, targetAsset } = request;

    const prioritySwapAssets = await this.getPrioritySwapAssets(targetAsset);

    // calculating how much targetAmount is needed and if it's available on the node
    const { targetAmount, availableAmount, maxPurchasableAmount, isSlippageDetected, feeAmount } =
      await this.dexDeFiChainService.getAndCheckAvailableTargetLiquidity(
        referenceAsset,
        referenceAmount,
        targetAsset,
        LiquidityOrder.getMaxPriceSlippage(targetAsset.dexName),
        prioritySwapAssets,
      );

    return this.createCheckLiquidityResult(
      request,
      targetAmount,
      availableAmount,
      maxPurchasableAmount,
      isSlippageDetected,
      await this.feeAsset(),
      feeAmount,
    );
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getAssetByQuery({
      dexName: 'DFI',
      blockchain: Blockchain.DEFICHAIN,
      type: AssetType.COIN,
    });
  }

  //*** HELPER METHODS ***/

  private async getPrioritySwapAssets(targetAsset: Asset): Promise<Asset[]> {
    try {
      const purchaseStrategy = this.purchaseStrategies.getPurchaseLiquidityStrategy(
        targetAsset,
      ) as DeFiChainNonPoolPairStrategy;

      if (!purchaseStrategy) return [];

      return purchaseStrategy.getPrioritySwapAssets();
    } catch (e) {
      const { dexName, type, blockchain } = targetAsset;
      console.warn(
        `Error while getting priority assets from purchase liquidity strategy. Target asset: ${dexName} ${type} ${blockchain}`,
      );

      return [];
    }
  }

  private createCheckLiquidityResult(
    request: LiquidityRequest,
    targetAmount: number,
    availableAmount: number,
    maxPurchasableAmount: number,
    isSlippageDetected: boolean,
    feeAsset: Asset,
    feeAmount: number,
  ): CheckLiquidityResult {
    const { referenceAsset, referenceAmount, targetAsset } = request;

    return {
      target: {
        asset: targetAsset,
        amount: targetAmount,
        availableAmount,
        maxPurchasableAmount,
      },
      reference: {
        asset: referenceAsset,
        amount: referenceAmount,
        availableAmount: (availableAmount / targetAmount) * referenceAmount,
        maxPurchasableAmount: (maxPurchasableAmount / targetAmount) * referenceAmount,
      },
      purchaseFee: {
        asset: feeAsset,
        amount: feeAmount,
      },
      metadata: {
        isEnoughLiquidity: availableAmount > targetAmount * 1.05,
        isSlippageDetected,
      },
    };
  }
}
