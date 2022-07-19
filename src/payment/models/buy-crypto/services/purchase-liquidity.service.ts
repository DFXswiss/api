import { Injectable } from '@nestjs/common';
import { DeFiClient } from 'src/ain/node/defi-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { Config } from 'src/config/config';
import { AssetCategory } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Util } from 'src/shared/util';
import { BuyCryptoBatch } from '../entities/buy-crypto-batch.entity';
import { BuyCryptoNotificationService } from './buy-crypto-notification.service';
import { BuyCryptoChainUtil } from '../utils/buy-crypto-chain.util';

@Injectable()
export class PurchaseLiquidityService {
  #dexClient: DeFiClient;

  constructor(
    private readonly buyCryptoNotificationService: BuyCryptoNotificationService,
    private readonly buyCryptoChainUtil: BuyCryptoChainUtil,
    private readonly assetService: AssetService,
    readonly nodeService: NodeService,
  ) {
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.#dexClient = client));
  }

  async purchaseLiquidity(batch: BuyCryptoBatch): Promise<string> {
    const { swapAsset, swapAmount, maxPrice } = await this.getSuitableSwapAsset(batch);

    console.log('MAX PRICE', swapAsset, swapAmount, maxPrice);

    const txId = await this.#dexClient.compositeSwap(
      Config.node.dexWalletAddress,
      swapAsset,
      Config.node.dexWalletAddress,
      batch.outputAsset,
      swapAmount,
      [],
      maxPrice,
    );

    console.info(
      `Purchased ${swapAmount} ${swapAsset} worth liquidity for asset ${batch.outputAsset}. Batch ID: ${batch.id}. Transaction ID: ${txId}`,
    );

    return txId;
  }

  private async getSuitableSwapAsset(batch: BuyCryptoBatch): Promise<{
    swapAsset: string;
    swapAmount: number;
    maxPrice: number;
  }> {
    const targetAsset = await this.assetService.getAssetByDexName(batch.outputAsset);

    const prioritySwapAsset = targetAsset.category === AssetCategory.D_TOKEN ? 'DUSD' : 'DFI';
    const fallbackSwapAsset = 'DFI';

    const priorityResult = await this.tryAssetSwap(prioritySwapAsset, batch);
    if (!priorityResult.error) return priorityResult.result;

    const fallbackResult = await this.tryAssetSwap(fallbackSwapAsset, batch);
    if (!fallbackResult.error) return fallbackResult.result;

    const errorMessage = 'Failed to purchase liquidity on DEX node. '.concat(
      priorityResult.error,
      fallbackResult.error,
    );

    this.buyCryptoNotificationService.sendNonRecoverableErrorMail(errorMessage);
    throw new Error(errorMessage);
  }

  private async tryAssetSwap(
    swapAsset: string,
    batch: BuyCryptoBatch,
  ): Promise<{
    result?: {
      swapAsset: string;
      swapAmount: number;
      maxPrice: number;
    };
    error?: string;
  }> {
    try {
      const baseOutputAssetPrice =
        1 /
        ((await this.#dexClient.testCompositeSwap(swapAsset, batch.outputAsset, batch.minimalOutputReferenceAmount)) /
          batch.minimalOutputReferenceAmount);

      const maxOutputAssetPrice = Util.round(baseOutputAssetPrice + baseOutputAssetPrice * batch.maxPriceSlippage, 8);

      const requiredSwapAmount = await this.calculateLiquiditySwapAmount(swapAsset, batch);
      const availableSwapAssetAmount = await this.buyCryptoChainUtil.getAvailableTokenAmount(
        swapAsset,
        this.#dexClient,
      );

      const result = { swapAsset, swapAmount: requiredSwapAmount, maxPrice: maxOutputAssetPrice };

      // 5% cap for unexpected meantime swaps
      if (requiredSwapAmount * 1.05 > availableSwapAssetAmount) {
        const error = `Not enough ${swapAsset} liquidity on DEX Node. Trying to purchase ${requiredSwapAmount} ${swapAsset} worth liquidity for asset ${batch.outputAsset}. Available amount: ${availableSwapAssetAmount}.`;
        console.error(error);

        return { result, error };
      }

      return { result };
    } catch (e) {
      console.warn(`Error on trying asset swap`, e);

      return { error: e };
    }
  }

  private async calculateLiquiditySwapAmount(swapAsset: string, batch: BuyCryptoBatch): Promise<number> {
    if (batch.isReferenceAsset) {
      const referencePrice =
        (await this.#dexClient.testCompositeSwap(
          batch.outputReferenceAsset,
          swapAsset,
          batch.minimalOutputReferenceAmount,
        )) / batch.minimalOutputReferenceAmount;

      const swapAmount = batch.outputReferenceAmount * referencePrice;

      // adding 5% reserve cap for non-reference asset liquidity swap
      return Util.round(swapAmount + swapAmount * 0.05, 8);
    }

    return this.#dexClient.testCompositeSwap(batch.outputReferenceAsset, swapAsset, batch.outputReferenceAmount);
  }
}
