import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { IsNull, Not } from 'typeorm';
import { LiquidityOrder, LiquidityOrderContext } from '../../../entities/liquidity-order.entity';
import { NotEnoughLiquidityException } from '../../../exceptions/not-enough-liquidity.exception';
import { PriceSlippageException } from '../../../exceptions/price-slippage.exception';
import { LiquidityOrderFactory } from '../../../factories/liquidity-order.factory';
import { PurchaseLiquidityRequest } from '../../../interfaces';
import { LiquidityOrderRepository } from '../../../repositories/liquidity-order.repository';
import { DexDeFiChainService } from '../../../services/dex-defichain.service';
import { DexService } from '../../../services/dex.service';
import { DexUtil } from '../../../utils/dex.util';
import { PurchaseLiquidityStrategy } from './base/purchase-liquidity.strategy';

@Injectable()
export class DeFiChainPoolPairStrategy extends PurchaseLiquidityStrategy {
  private readonly logger = new DfxLogger(DeFiChainPoolPairStrategy);

  constructor(
    readonly notificationService: NotificationService,
    private readonly assetService: AssetService,
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    private readonly liquidityOrderFactory: LiquidityOrderFactory,
    @Inject(forwardRef(() => DexService))
    private readonly dexService: DexService,
    private readonly dexDeFiChainService: DexDeFiChainService,
  ) {
    super(notificationService);
  }

  get blockchain(): Blockchain {
    return Blockchain.DEFICHAIN;
  }

  get assetType(): AssetType {
    return undefined;
  }

  get assetCategory(): AssetCategory {
    return AssetCategory.POOL_PAIR;
  }

  get dexName(): string {
    return undefined;
  }

  async purchaseLiquidity(request: PurchaseLiquidityRequest): Promise<void> {
    const newParentOrder = this.liquidityOrderFactory.createPurchaseOrder(
      request,
      Blockchain.DEFICHAIN,
      this.constructor.name,
    );
    const savedParentOrder = await this.liquidityOrderRepo.save(newParentOrder);

    try {
      const [leftAsset, rightAsset] = await this.getAssetPair(request.targetAsset);

      await this.secureLiquidityForPairAsset(savedParentOrder, leftAsset);
      await this.secureLiquidityForPairAsset(savedParentOrder, rightAsset);
    } catch (e) {
      await this.cleanupOrders(savedParentOrder);
      await this.handlePurchaseLiquidityError(e, request);
    }
  }

  async addPurchaseData(order: LiquidityOrder): Promise<void> {
    const amount = await this.dexDeFiChainService.getSwapAmount(order.txId, order.targetAsset.dexName);

    order.purchased(amount);
    order.recordFee(await this.feeAsset(), 0);

    await this.dexService.completeOrders(LiquidityOrderContext.CREATE_POOL_PAIR, order.id.toString());
    await this.liquidityOrderRepo.save(order);
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  @Lock(1800)
  async verifyDerivedOrders(): Promise<void> {
    const pendingParentOrders = await this.liquidityOrderRepo.findBy({
      context: Not(LiquidityOrderContext.CREATE_POOL_PAIR),
      isReady: false,
      txId: IsNull(),
    });

    for (const parentOrder of pendingParentOrders) {
      try {
        const derivedOrders = await this.liquidityOrderRepo.findBy({
          context: LiquidityOrderContext.CREATE_POOL_PAIR,
          correlationId: parentOrder.id.toString(),
          isReady: true,
          isComplete: false,
        });

        if (derivedOrders.length === 2) {
          await this.addPoolPair(parentOrder, derivedOrders);
        }
      } catch (e) {
        this.logger.error(`Error while verifying derived liquidity order (parent order ID: ${parentOrder.id}):`, e);
        continue;
      }
    }
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getDfiCoin();
  }

  private async getAssetPair(asset: Asset): Promise<[Asset, Asset]> {
    const assetPair = DexUtil.parseAssetPair(asset);

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
        `Could not find all matching assets for pair ${asset.dexName}. LeftAsset: ${leftAsset.dexName}. Right asset: ${rightAsset.dexName}`,
      );
    }

    return [leftAsset, rightAsset];
  }

  private async secureLiquidityForPairAsset(parentOrder: LiquidityOrder, pairAsset: Asset): Promise<void> {
    // in case of retry - check if a liquidity order was created in a previous try, if yes - prevent creating new one
    const existingOrder = await this.liquidityOrderRepo.findOneBy({
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
    const [leftAsset, rightAsset] = DexUtil.parseAssetPair(parentOrder.targetAsset);

    const leftOrder = derivedOrders.find((o) => o.targetAsset.dexName === leftAsset);
    const rightOrder = derivedOrders.find((o) => o.targetAsset.dexName === rightAsset);

    this.logger.verbose(
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
    leftAssetName: string,
    leftAmount: number,
    rightAssetName: string,
    rightAmount: number,
  ): Promise<void> {
    const poolPair: [string, string] = [`${leftAmount}@${leftAssetName}`, `${rightAmount}@${rightAssetName}`];

    const txId = await this.dexDeFiChainService.addPoolLiquidity(poolPair);

    order.addBlockchainTransactionMetadata(txId);

    this.logger.verbose(
      `Booked poolpair purchase of ${leftAmount} ${leftAssetName} and ${rightAmount} ${rightAssetName} . Context: ${order.context}. CorrelationId: ${order.correlationId}.`,
    );
  }

  private isPoolPairSlippageError(e: Error): boolean {
    return e.message && e.message.includes('Exceeds max ratio slippage protection');
  }

  private async cleanupOrders(parentOrder: LiquidityOrder): Promise<void> {
    this.logger.warn(`Pool pair liquidity order failed. Cleaning up parent order ${parentOrder.id}`);

    await this.liquidityOrderRepo.delete({
      context: LiquidityOrderContext.CREATE_POOL_PAIR,
      correlationId: parentOrder.id.toString(),
    });
    await this.liquidityOrderRepo.delete({ id: parentOrder.id });
  }
}
