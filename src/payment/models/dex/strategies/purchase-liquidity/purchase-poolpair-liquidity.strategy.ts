import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DeFiClient } from 'src/ain/node/defi-client';
import { Config } from 'src/config/config';
import { Asset, AssetCategory } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { MailService } from 'src/shared/services/mail.service';
import { Not } from 'typeorm';
import { LiquidityOrder, LiquidityOrderContext } from '../../entities/liquidity-order.entity';
import { LiquidityOrderFactory } from '../../factories/liquidity-order.factory';
import { LiquidityOrderRepository } from '../../repositories/liquidity-order.repository';
import { DEXService, LiquidityRequest } from '../../services/dex.service';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';
import { Util } from 'src/shared/util';
import { Lock } from 'src/shared/lock';
import { NotEnoughLiquidityException } from '../../exceptions/not-enough-liquidity.exception';
import { PriceSlippageException } from '../../exceptions/price-slippage.exception';
import { SettingService } from 'src/shared/models/setting/setting.service';

@Injectable()
export class PurchasePoolPairLiquidityStrategy extends PurchaseLiquidityStrategy {
  private readonly verifyDerivedOrdersLock = new Lock(1800);

  #chainClient: DeFiClient;

  constructor(
    readonly mailService: MailService,
    private readonly settingService: SettingService,
    private readonly assetService: AssetService,
    private readonly liquidityOrderFactory: LiquidityOrderFactory,
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    private readonly dexService: DEXService,
  ) {
    super(mailService);
  }

  async purchaseLiquidity(request: LiquidityRequest): Promise<void> {
    if ((await this.settingService.get('purchase-poolpair-liquidity')) !== 'on') return;

    const order = this.liquidityOrderFactory.createPurchaseOrder(request, 'defichain', AssetCategory.POOL_PAIR);

    try {
      const parentOrder = await this.liquidityOrderRepo.save(order);

      const [leftAsset, rightAsset] = await this.getAssetPair(request.targetAsset);

      await this.secureLiquidityForPairAsset(parentOrder, leftAsset);
      await this.secureLiquidityForPairAsset(parentOrder, rightAsset);
    } catch (e) {
      this.handlePurchaseLiquidityError(e, order);
    }
  }

  @Interval(60000)
  async verifyDerivedOrders(): Promise<void> {
    if ((await this.settingService.get('purchase-poolpair-liquidity')) !== 'on') return;

    if (!this.verifyDerivedOrdersLock.acquire()) return;

    const pendingParentOrders = await this.liquidityOrderRepo.find({
      context: Not(LiquidityOrderContext.CREATE_POOL_PAIR),
      isReady: false,
    });

    for (const parentOrder of pendingParentOrders) {
      try {
        const derivedOrders = await this.liquidityOrderRepo.find({
          context: LiquidityOrderContext.CREATE_POOL_PAIR,
          correlationId: parentOrder.id.toString(),
        });

        if (derivedOrders.length === 2 && derivedOrders.every((o) => o.isReady)) {
          await this.addPoolPair(parentOrder, derivedOrders);
          await this.dexService.completeOrders(LiquidityOrderContext.CREATE_POOL_PAIR, parentOrder.id.toString());
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

  private async secureLiquidityForPairAsset(parentOrder: LiquidityOrder, pairAsset: Asset): Promise<void> {
    // in case of retry - check if a liquidity order was created in a previous try, if yes - prevent creating new one
    const existingOrder = await this.liquidityOrderRepo.findOne({
      context: LiquidityOrderContext.CREATE_POOL_PAIR,
      correlationId: parentOrder.id.toString(),
    });

    if (existingOrder) return;

    const request = {
      context: LiquidityOrderContext.CREATE_POOL_PAIR,
      correlationId: parentOrder.id.toString(),
      referenceAsset: parentOrder.referenceAsset,
      referenceAmount: Util.round(parentOrder.referenceAmount / 2, 8),
      targetAsset: pairAsset,
    };

    try {
      await this.dexService.reserveLiquidity(request);
    } catch (e) {
      if (e instanceof NotEnoughLiquidityException) {
        await this.purchaseLiquidity(request);
      }

      throw e;
    }
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
      if (this.isPoolPairSlippageError(e)) {
        throw new PriceSlippageException(e.message);
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

    order.addPurchaseMetadata(chainSwapId);
  }

  private isPoolPairSlippageError(e: Error): boolean {
    return e.message && e.message.includes('Exceeds max ratio slippage protection');
  }
}
