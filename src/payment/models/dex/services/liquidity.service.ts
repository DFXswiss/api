import { Injectable } from '@nestjs/common';
import { DeFiClient } from 'src/ain/node/defi-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/util';
import { ChainSwapId, LiquidityOrder, TargetAmount } from '../entities/liquidity-order.entity';
import { NotEnoughLiquidityException } from '../exceptions/not-enough-liquidity.exception';
import { PriceSlippageException } from '../exceptions/price-slippage.exception';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { DeFiChainUtil } from '../utils/defichain.util';

@Injectable()
export class LiquidityService {
  #dexClient: DeFiClient;

  constructor(
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    private readonly deFiChainUtil: DeFiChainUtil,
    readonly nodeService: NodeService,
  ) {
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.#dexClient = client));
  }

  // *** PUBLIC API *** //

  async getAvailableTargetLiquidity(
    sourceAsset: string,
    sourceAmount: number,
    targetAsset: string,
    maxSlippage: number,
  ): Promise<TargetAmount> {
    const targetAmount =
      targetAsset === sourceAsset
        ? sourceAmount
        : await this.#dexClient.testCompositeSwap(sourceAsset, targetAsset, sourceAmount);

    await this.checkTestSwapPriceSlippage(sourceAsset, sourceAmount, targetAsset, targetAmount, maxSlippage);
    await this.checkAssetAvailability(targetAsset, targetAmount);

    return targetAmount;
  }

  async purchaseLiquidity(
    sourceAsset: string,
    sourceAmount: number,
    targetAsset: string,
    maxSlippage: number,
  ): Promise<ChainSwapId> {
    const maxPrice = await this.calculateMaxTargetAssetPrice(sourceAsset, targetAsset, maxSlippage);

    try {
      return await this.#dexClient.compositeSwap(
        Config.node.dexWalletAddress,
        sourceAsset,
        Config.node.dexWalletAddress,
        targetAsset,
        sourceAmount,
        [],
        maxPrice,
      );
    } catch (e) {
      if (this.isCompositeSwapSlippageError(e)) {
        throw new PriceSlippageException(e.message);
      }

      throw e;
    }
  }

  async getPurchasedAmount(txId: string, asset: string): Promise<number> {
    const historyEntry = await this.deFiChainUtil.getHistoryEntryForTx(txId, this.#dexClient);

    if (!historyEntry) {
      throw new Error(`Could not find transaction with ID: ${txId} while trying to extract purchased liquidity`);
    }

    const amounts = historyEntry.amounts.map((a) => this.#dexClient.parseAmount(a));

    const { amount: purchasedAmount } = amounts.find((a) => a.asset === asset);

    if (!purchasedAmount) {
      throw new Error(`Failed to get amount for TX: ${txId} while trying to extract purchased liquidity`);
    }

    return purchasedAmount;
  }

  async getSwapAmountForPurchase(
    referenceAsset: string,
    referenceAmount: number,
    targetAsset: string,
    swapAsset: string,
  ): Promise<number> {
    const swapAmount = await this.calculateSwapAmountForPurchase(
      referenceAsset,
      referenceAmount,
      targetAsset,
      swapAsset,
    );

    await this.checkAssetAvailability(swapAsset, swapAmount);

    return swapAmount;
  }

  // *** HELPER METHODS *** //

  private async checkAssetAvailability(asset: string, amount: number): Promise<{ asset: string; amount: number }> {
    const pendingOrders = (await this.liquidityOrderRepo.find({ isReady: true, isComplete: false })).filter(
      (o) => o.targetAsset.dexName === asset,
    );
    const pendingAmount = Util.sumObj<LiquidityOrder>(pendingOrders, 'targetAmount');

    const availableAmount = await this.deFiChainUtil.getAvailableTokenAmount(asset, this.#dexClient);

    // 5% cap for unexpected meantime swaps
    if (amount * 1.05 > availableAmount - pendingAmount) {
      throw new NotEnoughLiquidityException(
        `Not enough liquidity of asset ${asset}. Trying to use ${amount} ${asset} worth liquidity. Available amount: ${availableAmount}.`,
      );
    }

    return { asset, amount };
  }

  private async calculateSwapAmountForPurchase(
    referenceAsset: string,
    referenceAmount: number,
    targetAsset: string,
    swapAsset: string,
  ): Promise<number> {
    if (referenceAsset === targetAsset) {
      const swapAssetPrice = await this.calculateTargetAssetPrice(referenceAsset, swapAsset);

      const swapAmount = referenceAmount / swapAssetPrice;

      // adding 5% cap to liquidity swap to cover meantime referenceAmount price difference (initially taken from Kraken/Binance)
      return Util.round(swapAmount + swapAmount * 0.05, 8);
    }

    return this.#dexClient.testCompositeSwap(referenceAsset, swapAsset, referenceAmount);
  }

  private async checkTestSwapPriceSlippage(
    sourceAsset: string,
    sourceAmount: number,
    targetAsset: string,
    targetAmount: number,
    maxSlippage: number,
  ): Promise<void> {
    const maxPrice = await this.calculateMaxTargetAssetPrice(sourceAsset, targetAsset, maxSlippage);

    const minimalAllowedTargetAmount = Util.round(sourceAmount / maxPrice, 8);

    if (targetAmount < minimalAllowedTargetAmount) {
      throw new PriceSlippageException(
        `Price is higher than indicated. Maximum price for asset ${targetAsset} is ${maxPrice} ${sourceAsset}`,
      );
    }
  }

  private async calculateMaxTargetAssetPrice(
    sourceAsset: string,
    targetAsset: string,
    maxSlippage: number,
  ): Promise<number> {
    const targetAssetPrice = await this.calculateTargetAssetPrice(sourceAsset, targetAsset);

    return Util.round(targetAssetPrice * (1 + maxSlippage), 8);
  }

  private async calculateTargetAssetPrice(sourceAsset: string, targetAsset: string): Promise<number> {
    return 1 / (await this.calculateSourceAssetPrice(sourceAsset, targetAsset));
  }

  private async calculateSourceAssetPrice(sourceAsset: string, targetAsset: string): Promise<number> {
    return (await this.#dexClient.testCompositeSwap(sourceAsset, targetAsset, 0.001)) / 0.001;
  }

  private isCompositeSwapSlippageError(e: Error): boolean {
    return e.message && e.message.includes('Price is higher than indicated');
  }

  // TODO - double check where such error comes from
  private isAssetNotAvailableError(e: Error): boolean {
    return e.message && e.message.includes('Cannot find usable pool pair');
  }
}
