import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DeFiClient } from 'src/ain/node/defi-client';
import { Config } from 'src/config/config';
import { Asset, AssetCategory } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { MailService } from 'src/shared/services/mail.service';
import { IsNull, Not } from 'typeorm';
import { LiquidityOrder, LiquidityOrderContext } from '../../entities/liquidity-order.entity';
import { AssetNotAvailableException } from '../../exceptions/asset-not-available.exception';
import { LiquidityOrderFactory } from '../../factories/liquidity-order.factory';
import { LiquidityOrderRepository } from '../../repositories/liquidity-order.repository';
import { SwapLiquidityService } from '../../services/swap-liquidity.service';
import { DeFiChainUtil } from '../../utils/defichain.util';
import { LiquidityRequest } from '../../services/dex.service';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';

@Injectable()
export class PurchasePoolPairLiquidityStrategy extends PurchaseLiquidityStrategy {
  #chainClient: DeFiClient;

  constructor(
    readonly mailService: MailService,
    private readonly assetService: AssetService,
    private readonly deFiChainUtil: DeFiChainUtil,
    private readonly liquidityOrderFactory: LiquidityOrderFactory,
    private readonly swapLiquidityService: SwapLiquidityService,
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
  ) {
    super(mailService);
  }

  async purchaseLiquidity(request: LiquidityRequest): Promise<void> {
    const newOrder = this.liquidityOrderFactory.createFromRequest(request, 'defichain');

    try {
      const parentOrder = await this.liquidityOrderRepo.save(newOrder);

      const [leftAsset, rightAsset] = await this.getAssetPair(request.targetAsset);

      await this.createDerivedPurchaseOrder(leftAsset, parentOrder);
      await this.createDerivedPurchaseOrder(rightAsset, parentOrder);
    } catch (e) {
      this.handlePurchaseLiquidityError(e, newOrder);
    }
  }

  @Interval(60000)
  async checkParentOrders(): Promise<void> {
    const standingParentOrders = await this.liquidityOrderRepo.find({
      where: { context: LiquidityOrderContext.CREATE_POOL_PAIR, isComplete: false, chainSwapId: Not(IsNull()) },
    });

    for (const order of standingParentOrders) {
      const amount = await this.swapLiquidityService.getSwapResult(order.chainSwapId, order.targetAsset.dexName);

      order.complete(amount);
      await this.liquidityOrderRepo.save(order);
    }
  }

  @Interval(60000)
  async checkDerivedOrders(): Promise<void> {
    const standingDerivedOrders = await this.liquidityOrderRepo.find({
      where: { context: LiquidityOrderContext.CREATE_POOL_PAIR, isComplete: false, chainSwapId: Not(IsNull()) },
    });

    for (const derivedOrder of standingDerivedOrders) {
      const amount = await this.swapLiquidityService.getSwapResult(
        derivedOrder.chainSwapId,
        derivedOrder.targetAsset.dexName,
      );

      derivedOrder.complete(amount);
      await this.liquidityOrderRepo.save(derivedOrder);
    }

    // replace with query builder to look for nested conditions
    const pendingParentOrders = await this.liquidityOrderRepo
      .find({
        where: { context: Not(LiquidityOrderContext.CREATE_POOL_PAIR), isComplete: false, chainSwapId: IsNull() },
      })
      .then((orders) => orders.filter((o) => o.targetAsset?.category === AssetCategory.POOL_PAIR));

    for (const parentOrder of pendingParentOrders) {
      const derivedOrders = standingDerivedOrders.filter((o) => o.correlationId === parentOrder.id.toString());

      if (derivedOrders.every((o) => o.isComplete)) {
        await this.addPoolPair(parentOrder, derivedOrders);
      }
    }
  }

  private parseAssetPair(asset: Asset): [string, string] {
    const assetPair = asset.dexName.split('-');

    if (assetPair.length !== 2) {
      throw new Error(`Provided asset is not a liquidity pool pair. dexName: ${asset.dexName}`);
    }

    return [assetPair[0], assetPair[1]];
  }

  private async getAssetPair(asset: Asset): Promise<[Asset, Asset]> {
    const assetPair = this.parseAssetPair(asset);

    const leftAsset = await this.assetService.getAssetByDexName(assetPair[0]);
    const rightAsset = await this.assetService.getAssetByDexName(assetPair[1]);

    if (!leftAsset || !rightAsset) {
      throw new Error(
        `Could not find all matching assets for pair ${asset.dexName}. LeftAsset: ${leftAsset}. Right asset: ${rightAsset}`,
      );
    }

    return [leftAsset, rightAsset];
  }

  private async createDerivedPurchaseOrder(pairAsset: Asset, parentOrder: LiquidityOrder): Promise<void> {
    const request = {
      context: LiquidityOrderContext.CREATE_POOL_PAIR,
      correlationId: parentOrder.id.toString(),
      referenceAsset: parentOrder.referenceAsset,
      referenceAmount: parentOrder.referenceAmount / 2,
      targetAsset: pairAsset,
    };
    const order = this.liquidityOrderFactory.createFromRequest(request, 'defichain');
    const chainSwapId = await this.bookLiquiditySwap(order);

    order.addChainSwapId(chainSwapId);

    await this.liquidityOrderRepo.save(order);
  }

  private async addPoolPair(parentOrder: LiquidityOrder, derivedOrders: LiquidityOrder[]): Promise<void> {
    const [leftAsset, rightAsset] = this.parseAssetPair(parentOrder.targetAsset);

    const leftOrder = derivedOrders.find((o) => o.targetAsset.dexName === leftAsset);
    const rightOrder = derivedOrders.find((o) => o.targetAsset.dexName === rightAsset);

    const poolPair: [string, string] = [
      `${leftOrder.targetAmount}@${leftOrder.targetAsset.dexName}`,
      `${rightOrder.targetAmount}@${rightOrder.targetAsset.dexName}`,
    ];

    const chainSwapId = await this.#chainClient.addPoolLiquidity(
      Config.node.dexWalletAddress,
      Config.node.dexWalletAddress,
      poolPair,
    );

    parentOrder.addChainSwapId(chainSwapId);

    await this.liquidityOrderRepo.save(parentOrder);
  }

  private async bookLiquiditySwap(order: LiquidityOrder): Promise<string> {
    const { referenceAsset, referenceAmount, targetAsset, maxPriceSlippage } = order;

    const { asset: sourceAsset, amount: sourceAmount } = await this.getSuitableSourceAsset(
      referenceAsset,
      referenceAmount,
    );

    const txId = await this.swapLiquidityService.doAssetSwap(
      sourceAsset,
      sourceAmount,
      targetAsset.dexName,
      maxPriceSlippage,
    );

    console.info(
      `Booked ${sourceAmount} ${sourceAsset} worth liquidity for asset ${order.targetAsset.dexName}. Context: ${order.context}. CorrelationId: ${order.correlationId}.`,
    );

    return txId;
  }

  private async getSuitableSourceAsset(
    referenceAsset: string,
    referenceAmount: number,
  ): Promise<{ asset: string; amount: number }> {
    const errors = [];

    try {
      return await this.swapLiquidityService.tryAssetAvailability(referenceAsset, referenceAmount, 'DUSD');
    } catch (e) {
      errors.push(e.message);
    }

    try {
      return await this.swapLiquidityService.tryAssetAvailability(referenceAsset, referenceAmount, 'DFI');
    } catch (e) {
      errors.push(e.message);
    }

    throw new AssetNotAvailableException(
      `Failed to find suitable source asset for liquidity order. `.concat(...errors),
    );
  }
}
