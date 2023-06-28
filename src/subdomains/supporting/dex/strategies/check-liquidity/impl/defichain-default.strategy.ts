import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrder } from '../../../entities/liquidity-order.entity';
import { CheckLiquidityRequest, CheckLiquidityResult } from '../../../interfaces';
import { DexDeFiChainLiquidityResult, DexDeFiChainService } from '../../../services/dex-defichain.service';
import { DeFiChainNonPoolPairStrategy } from '../../purchase-liquidity/impl/base/defichain-non-poolpair.strategy';
import { PurchaseLiquidityStrategyRegistry } from '../../purchase-liquidity/impl/base/purchase-liquidity.strategy-registry';
import { CheckLiquidityStrategy } from './base/check-liquidity.strategy';

@Injectable()
export class DeFiChainDefaultStrategy extends CheckLiquidityStrategy {
  private readonly logger = new DfxLogger(DeFiChainDefaultStrategy);

  constructor(
    protected readonly assetService: AssetService,
    private readonly dexDeFiChainService: DexDeFiChainService,
    private readonly purchaseLiquidityStrategyRegistry: PurchaseLiquidityStrategyRegistry,
  ) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.DEFICHAIN;
  }

  get assetType(): AssetType {
    return undefined;
  }

  get assetCategory(): AssetCategory {
    return undefined;
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
      const purchaseStrategy = this.purchaseLiquidityStrategyRegistry.getPurchaseLiquidityStrategy(
        targetAsset,
      ) as DeFiChainNonPoolPairStrategy;

      if (!purchaseStrategy) return [];

      return await purchaseStrategy.getPrioritySwapAssets();
    } catch (e) {
      this.logger.warn(`Error while getting priority assets for ${targetAsset.uniqueName}:`, e);

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
