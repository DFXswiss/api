import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityOrder } from '../../../../entities/liquidity-order.entity';
import { NotEnoughLiquidityException } from '../../../../exceptions/not-enough-liquidity.exception';
import { LiquidityOrderFactory } from '../../../../factories/liquidity-order.factory';
import { PurchaseLiquidityRequest } from '../../../../interfaces';
import { LiquidityOrderRepository } from '../../../../repositories/liquidity-order.repository';
import { DexDeFiChainService } from '../../../../services/dex-defichain.service';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';
import { PurchaseLiquidityStrategyAlias } from '../../purchase-liquidity.facade';

export abstract class DeFiChainNonPoolPairStrategy extends PurchaseLiquidityStrategy {
  private prioritySwapAssetDescriptors: { name: string; type: AssetType }[] = [];
  private prioritySwapAssets: Asset[] = [];

  constructor(
    notificationService: NotificationService,
    protected readonly assetService: AssetService,
    protected readonly dexDeFiChainService: DexDeFiChainService,
    protected readonly liquidityOrderRepo: LiquidityOrderRepository,
    protected readonly liquidityOrderFactory: LiquidityOrderFactory,
    prioritySwapAssetDescriptors: { name: string; type: AssetType }[],
    name: PurchaseLiquidityStrategyAlias,
  ) {
    super(notificationService, name);
    this.prioritySwapAssetDescriptors = prioritySwapAssetDescriptors;
  }

  //*** PUBLIC API ***//

  async purchaseLiquidity(request: PurchaseLiquidityRequest): Promise<void> {
    const order = this.liquidityOrderFactory.createPurchaseOrder(request, Blockchain.DEFICHAIN, this.name);

    try {
      await this.bookLiquiditySwap(order);
      await this.liquidityOrderRepo.save(order);
    } catch (e) {
      await this.handlePurchaseLiquidityError(e, request);
    }
  }

  async addPurchaseData(order: LiquidityOrder): Promise<void> {
    const amount = await this.dexDeFiChainService.getSwapAmount(order.txId, order.targetAsset.dexName);

    order.purchased(amount);
    order.recordFee(await this.feeAsset(), 0);
    await this.liquidityOrderRepo.save(order);
  }

  async getPrioritySwapAssets(): Promise<Asset[]> {
    const prioritySwapAssets = [];

    for (const descriptor of this.prioritySwapAssetDescriptors) {
      try {
        const prioritySwapAsset = await this.getSwapAsset(descriptor);
        if (prioritySwapAsset) prioritySwapAssets.push(prioritySwapAsset);
      } catch {}
    }

    return prioritySwapAssets;
  }

  //*** HELPER METHODS ***//

  private async bookLiquiditySwap(order: LiquidityOrder): Promise<void> {
    const { referenceAsset, referenceAmount, targetAsset, maxPriceSlippage } = order;

    const { asset: swapAsset, amount: swapAmount } = await this.getSuitableSwapAssetName(
      referenceAsset,
      referenceAmount,
      targetAsset,
    );

    const txId = await this.dexDeFiChainService.swapLiquidity(swapAsset, swapAmount, targetAsset, maxPriceSlippage);

    console.info(
      `Booked purchase of ${swapAmount} ${swapAsset.dexName} worth liquidity for asset ${order.targetAsset.dexName}. Context: ${order.context}. CorrelationId: ${order.correlationId}.`,
    );

    order.addBlockchainTransactionMetadata(txId, swapAsset, swapAmount);
  }

  private async getSuitableSwapAssetName(
    referenceAsset: Asset,
    referenceAmount: number,
    targetAsset: Asset,
  ): Promise<{ asset: Asset; amount: number }> {
    const errors = [];

    for (const descriptor of this.prioritySwapAssetDescriptors) {
      const prioritySwapAsset = await this.getSwapAsset(descriptor);

      if (!(targetAsset.dexName === 'DUSD' && prioritySwapAsset.dexName === 'DUSD')) {
        try {
          return {
            asset: prioritySwapAsset,
            amount: await this.dexDeFiChainService.getSwapAmountForPurchase(
              referenceAsset,
              referenceAmount,
              targetAsset,
              prioritySwapAsset,
            ),
          };
        } catch (e) {
          if (e instanceof NotEnoughLiquidityException) {
            errors.push(e.message);
          } else {
            throw e;
          }
        }
      }
    }

    throw new NotEnoughLiquidityException(
      `Failed to find suitable source asset for liquidity order (target asset ${targetAsset.dexName}). `.concat(
        ...errors,
      ),
    );
  }

  private async getSwapAsset(descriptor: { name: string; type: AssetType }): Promise<Asset> {
    const { name, type } = descriptor;
    const cachedAsset = this.prioritySwapAssets.find(
      (a) => a.name === name && a.type === type && a.blockchain === Blockchain.DEFICHAIN,
    );

    if (cachedAsset) return cachedAsset;

    const asset = await this.assetService.getAssetByQuery({ dexName: name, type, blockchain: Blockchain.DEFICHAIN });

    if (asset) {
      this.prioritySwapAssets.push(asset);
      return asset;
    }

    throw new Error(
      `Swap Asset reference not found. Query: name - ${name}, type - ${type}, blockchain - ${Blockchain.DEFICHAIN}.`,
    );
  }
}
