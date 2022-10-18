import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DeFiClient } from 'src/blockchain/ain/node/defi-client';
import { Not } from 'typeorm';
import { Config } from 'src/config/config';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Util } from 'src/shared/util';
import { Lock } from 'src/shared/lock';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { NodeService, NodeType } from 'src/blockchain/ain/node/node.service';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { LiquidityOrderContext, LiquidityOrder } from '../../../entities/liquidity-order.entity';
import { NotEnoughLiquidityException } from '../../../exceptions/not-enough-liquidity.exception';
import { PriceSlippageException } from '../../../exceptions/price-slippage.exception';
import { LiquidityOrderFactory } from '../../../factories/liquidity-order.factory';
import { LiquidityRequest } from '../../../interfaces';
import { NotificationService } from 'src/notification/services/notification.service';
import { LiquidityOrderRepository } from '../../../repositories/liquidity-order.repository';
import { DexService } from '../../../services/dex.service';
import { PurchaseLiquidityStrategy } from './base/purchase-liquidity.strategy';

@Injectable()
export class DeFiChainPoolPairStrategy extends PurchaseLiquidityStrategy {
  private readonly verifyDerivedOrdersLock = new Lock(1800);

  private chainClient: DeFiClient;

  constructor(
    readonly nodeService: NodeService,
    readonly notificationService: NotificationService,
    private readonly settingService: SettingService,
    private readonly assetService: AssetService,
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    private readonly liquidityOrderFactory: LiquidityOrderFactory,
    @Inject(forwardRef(() => DexService))
    private readonly dexService: DexService,
  ) {
    super(notificationService);
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.chainClient = client));
  }

  async purchaseLiquidity(request: LiquidityRequest): Promise<void> {
    if ((await this.settingService.get('purchase-poolpair-liquidity')) !== 'on') return;

    const order = this.liquidityOrderFactory.createPurchaseOrder(
      request,
      Blockchain.DEFICHAIN,
      AssetCategory.POOL_PAIR,
    );

    try {
      const parentOrder = await this.liquidityOrderRepo.save(order);

      const [leftAsset, rightAsset] = await this.getAssetPair(request.targetAsset);

      await this.secureLiquidityForPairAsset(parentOrder, leftAsset);
      await this.secureLiquidityForPairAsset(parentOrder, rightAsset);
    } catch (e) {
      await this.handlePurchaseLiquidityError(e, request);
    }
  }

  @Interval(30000)
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
          isReady: true,
          isComplete: false,
        });

        if (derivedOrders.length === 2) {
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

    const leftAsset = await this.assetService.getAssetByQuery({
      dexName: assetPair[0],
      blockchain: Blockchain.DEFICHAIN,
      type: AssetType.TOKEN,
    });
    const rightAsset = await this.assetService.getAssetByQuery({
      dexName: assetPair[1],
      blockchain: Blockchain.DEFICHAIN,
      type: AssetType.TOKEN,
    });

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
      targetAsset: pairAsset,
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
        return this.dexService.purchaseLiquidity(request);
      }

      throw e;
    }
  }

  private async addPoolPair(parentOrder: LiquidityOrder, derivedOrders: LiquidityOrder[]): Promise<void> {
    const [leftAsset, rightAsset] = this.parseAssetPair(parentOrder.targetAsset);

    const leftOrder = derivedOrders.find((o) => o.targetAsset.dexName === leftAsset);
    const rightOrder = derivedOrders.find((o) => o.targetAsset.dexName === rightAsset);

    console.info(
      `Creating poolpair token of ${leftOrder.targetAsset.dexName} ${leftOrder.targetAmount} and ${rightOrder.targetAsset.dexName} ${rightOrder.targetAmount}`,
    );
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

    const txId = await this.chainClient.addPoolLiquidity(Config.blockchain.default.dexWalletAddress, poolPair);

    order.addPurchaseMetadata(txId);

    console.info(
      `Booked poolpair purchase of ${leftAmount} ${leftAsset} and ${rightAmount} ${rightAsset} . Context: ${order.context}. CorrelationId: ${order.correlationId}.`,
    );
  }

  private isPoolPairSlippageError(e: Error): boolean {
    return e.message && e.message.includes('Exceeds max ratio slippage protection');
  }
}
