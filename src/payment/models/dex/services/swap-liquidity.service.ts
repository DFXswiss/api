import { Injectable } from '@nestjs/common';
import { DeFiClient } from 'src/ain/node/defi-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/util';
import { ChainSwapId } from '../entities/liquidity-order.entity';
import { BuyCryptoChainUtil } from '../utils/buy-crypto-chain.util';

@Injectable()
export class SwapLiquidityService {
  #dexClient: DeFiClient;

  constructor(private readonly buyCryptoChainUtil: BuyCryptoChainUtil, readonly nodeService: NodeService) {
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.#dexClient = client));
  }

  async doAssetSwap(
    sourceAsset: string,
    sourceAmount: number,
    targetAsset: string,
    maxSlippage?: number,
  ): Promise<ChainSwapId> {
    const maxPrice = maxSlippage
      ? await this.calculateMaxTargetAssetPrice(sourceAsset, targetAsset, maxSlippage)
      : undefined;

    return this.#dexClient.compositeSwap(
      Config.node.dexWalletAddress,
      sourceAsset,
      Config.node.dexWalletAddress,
      targetAsset,
      sourceAmount,
      [],
      maxPrice,
    );
  }

  async tryAssetAvailability(
    sourceAsset: string,
    sourceAmount: number,
    targetAsset: string,
  ): Promise<{ asset: string; amount: number }> {
    const targetAmount = await this.calculateAssetAmount(sourceAsset, sourceAmount, targetAsset);
    const availableAmount = await this.buyCryptoChainUtil.getAvailableTokenAmount(targetAsset, this.#dexClient);

    // 5% cap for unexpected meantime swaps
    if (targetAmount * 1.05 > availableAmount) {
      throw new Error(
        `Not enough ${targetAsset} liquidity. Trying to convert ${targetAmount} ${targetAsset} worth liquidity for asset ${targetAsset}. Available amount: ${availableAmount}.`,
      );
    }

    return { asset: targetAsset, amount: targetAmount };
  }

  async calculateTargetAssetPrice(sourceAsset: string, targetAsset: string): Promise<number> {
    return 1 / (await this.calculateSourceAssetPrice(sourceAsset, targetAsset));
  }

  async calculateSourceAssetPrice(sourceAsset: string, targetAsset: string): Promise<number> {
    return (await this.#dexClient.testCompositeSwap(sourceAsset, targetAsset, 0.001)) / 0.001;
  }

  private async calculateAssetAmount(
    referenceAsset: string,
    referenceAmount: number,
    targetAsset: string,
  ): Promise<number> {
    if (this.isReferenceAsset(targetAsset)) {
      const targetAssetPrice = await this.calculateTargetAssetPrice(referenceAsset, targetAsset);

      const amount = referenceAmount / targetAssetPrice;

      // adding 5% reserve cap for non-reference asset liquidity swap
      return Util.round(amount + amount * 0.05, 8);
    }

    return this.#dexClient.testCompositeSwap(referenceAsset, targetAsset, referenceAmount);
  }

  private async calculateMaxTargetAssetPrice(
    sourceAsset: string,
    targetAsset: string,
    maxSlippage: number,
  ): Promise<number> {
    const targetAssetPrice = await this.calculateTargetAssetPrice(sourceAsset, targetAsset);

    return Util.round(targetAssetPrice * (1 + maxSlippage), 8);
  }

  private isReferenceAsset(asset: string): boolean {
    return asset === 'BTC' || asset === 'USDC' || asset === 'USDT';
  }
}
