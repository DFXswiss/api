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
import { LiquidityRequest } from '../../services/dex.service';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';
import { Util } from 'src/shared/util';
import { Lock } from 'src/shared/lock';

@Injectable()
export class PurchasePoolPairLiquidityStrategy extends PurchaseLiquidityStrategy {
  private readonly verifyDerivedOrdersLock = new Lock(1800);

  #chainClient: DeFiClient;

  constructor(
    readonly mailService: MailService,
    private readonly assetService: AssetService,
    private readonly liquidityOrderFactory: LiquidityOrderFactory,
    private readonly swapLiquidityService: SwapLiquidityService,
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
  ) {
    super(mailService);
  }

  async purchaseLiquidity(request: LiquidityRequest): Promise<void> {
    const order = this.liquidityOrderFactory.createFromRequest(request, 'defichain', AssetCategory.POOL_PAIR);

    try {
      const parentOrder = await this.liquidityOrderRepo.save(order);

      const [leftAsset, rightAsset] = await this.getAssetPair(request.targetAsset);

      await this.createDerivedPurchaseOrder(parentOrder, leftAsset);
      await this.createDerivedPurchaseOrder(parentOrder, rightAsset);
    } catch (e) {
      this.handlePurchaseLiquidityError(e, order);
    }
  }

  @Interval(60000)
  async verifyDerivedOrders(): Promise<void> {
    if (!this.verifyDerivedOrdersLock.acquire()) return;

    const pendingParentOrders = await this.liquidityOrderRepo.find({
      strategy: AssetCategory.POOL_PAIR,
      context: Not(LiquidityOrderContext.CREATE_POOL_PAIR),
      chainSwapId: IsNull(),
    });

    for (const parentOrder of pendingParentOrders) {
      try {
        const derivedOrders = await this.liquidityOrderRepo.find({
          strategy: AssetCategory.POOL_PAIR,
          context: LiquidityOrderContext.CREATE_POOL_PAIR,
          correlationId: parentOrder.id.toString(),
        });

        if (derivedOrders.every((o) => o.isReady)) {
          await this.addPoolPair(parentOrder, derivedOrders);
        }
      } catch (e) {
        console.error(`Error while verifying derived liquidity order. Parent Order ID: ${parentOrder.id}`, e);
        continue;
      }
    }

    this.verifyDerivedOrdersLock.release();
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

  private async createDerivedPurchaseOrder(parentOrder: LiquidityOrder, pairAsset: Asset): Promise<void> {
    const request = {
      context: LiquidityOrderContext.CREATE_POOL_PAIR,
      correlationId: parentOrder.id.toString(),
      referenceAsset: parentOrder.referenceAsset,
      referenceAmount: Util.round(parentOrder.referenceAmount / 2, 8),
      targetAsset: pairAsset,
    };
    const order = this.liquidityOrderFactory.createFromRequest(request, 'defichain', AssetCategory.POOL_PAIR);
    const chainSwapId = await this.bookLiquiditySwap(order);

    order.addChainSwapId(chainSwapId);

    await this.liquidityOrderRepo.save(order);
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
      if (this.swapLiquidityService.isAssetNotAvailableError(e)) {
        errors.push(e.message);
      } else {
        throw e;
      }
    }

    try {
      return await this.swapLiquidityService.tryAssetAvailability(referenceAsset, referenceAmount, 'DFI');
    } catch (e) {
      if (this.swapLiquidityService.isAssetNotAvailableError(e)) {
        errors.push(e.message);
      } else {
        throw e;
      }
    }

    throw new AssetNotAvailableException(
      `Failed to find suitable source asset for liquidity order. `.concat(...errors),
    );
  }

  private async addPoolPair(parentOrder: LiquidityOrder, derivedOrders: LiquidityOrder[]): Promise<void> {
    const [leftAsset, rightAsset] = this.parseAssetPair(parentOrder.targetAsset);

    const leftOrder = derivedOrders.find((o) => o.targetAsset.dexName === leftAsset);
    const rightOrder = derivedOrders.find((o) => o.targetAsset.dexName === rightAsset);

    try {
      await this.addPoolLiquidity(
        parentOrder,
        leftOrder.targetAsset.dexName,
        leftOrder.targetAmount,
        rightOrder.targetAsset.dexName,
        rightOrder.targetAmount,
      );
    } catch (e) {
      if (this.isBalanceError(e)) {
        await this.fixPoolLiquidityBalance(
          e,
          parentOrder,
          leftOrder.targetAsset.dexName,
          leftOrder.targetAmount,
          rightOrder.targetAsset.dexName,
          rightOrder.targetAmount,
        );
      }

      throw e;
    }

    await this.liquidityOrderRepo.save(parentOrder);
  }

  private async addPoolLiquidity(
    order: LiquidityOrder,
    leftAsset: string,
    leftAmount: number,
    rightAsset: string,
    rightAmount: number,
  ): Promise<void> {
    const poolPair: [string, string] = [`${leftAmount}@${leftAsset}`, `${rightAmount}@${rightAsset}`];

    const chainSwapId = await this.#chainClient.addPoolLiquidity(
      Config.node.dexWalletAddress,
      Config.node.dexWalletAddress,
      poolPair,
    );

    order.addChainSwapId(chainSwapId);
  }

  private async fixPoolLiquidityBalance(
    e: Error,
    order: LiquidityOrder,
    leftAsset: string,
    leftAmount: number,
    rightAsset: string,
    rightAmount: number,
  ) {
    await this.addPoolLiquidity(order, leftAsset, leftAmount, rightAsset, rightAmount);
  }

  private isBalanceError(e: Error): boolean {
    return e.message && e.message.includes('TBD');
  }
}
