import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityOrder } from '../../../entities/liquidity-order.entity';
import { CheckLiquidityResult, LiquidityRequest } from '../../../interfaces';
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

  async checkLiquidity(request: LiquidityRequest): Promise<CheckLiquidityResult> {
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

  private async createCheckLiquidityResult(
    request: LiquidityRequest,
    liquidity: DexDeFiChainLiquidityResult,
  ): Promise<CheckLiquidityResult> {
    const { referenceAsset, referenceAmount, targetAsset } = request;
    const { targetAmount, availableAmount, maxPurchasableAmount, isSlippageDetected, slippageMessage, feeAmount } =
      liquidity;

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
        // indicative calculation, doesn't have to be 100% precise (no test swap required)
        availableAmount: (availableAmount / targetAmount) * referenceAmount,
        maxPurchasableAmount: (maxPurchasableAmount / targetAmount) * referenceAmount,
      },
      purchaseFee: {
        asset: await this.feeAsset(),
        amount: feeAmount,
      },
      metadata: {
        isEnoughAvailableLiquidity: availableAmount > targetAmount * 1.05,
        isSlippageDetected,
        slippageMessage,
      },
    };
  }
}
