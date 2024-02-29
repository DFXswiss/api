import { Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { LiquidityOrder } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { NotEnoughLiquidityException } from 'src/subdomains/supporting/dex/exceptions/not-enough-liquidity.exception';
import { PriceSlippageException } from 'src/subdomains/supporting/dex/exceptions/price-slippage.exception';
import { LiquidityOrderFactory } from 'src/subdomains/supporting/dex/factories/liquidity-order.factory';
import { LiquidityOrderRepository } from 'src/subdomains/supporting/dex/repositories/liquidity-order.repository';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailRequest } from 'src/subdomains/supporting/notification/interfaces';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { PurchaseLiquidityRequest } from '../../../../interfaces';
import { PurchaseLiquidityStrategyRegistry } from './purchase-liquidity.strategy-registry';

export abstract class PurchaseLiquidityStrategy implements OnModuleInit, OnModuleDestroy {
  protected abstract readonly logger: DfxLogger;

  private _feeAsset: Asset;

  private prioritySwapAssets: Asset[];

  @Inject() protected readonly assetService: AssetService;
  @Inject() protected readonly liquidityOrderRepo: LiquidityOrderRepository;
  @Inject() protected readonly liquidityOrderFactory: LiquidityOrderFactory;
  @Inject() private readonly registry: PurchaseLiquidityStrategyRegistry;
  @Inject() private readonly notificationService: NotificationService;

  constructor(private swapAssetDescriptors: { name: string; type: AssetType }[]) {}

  onModuleInit() {
    this.registry.add(
      {
        blockchain: this.blockchain,
        assetType: this.assetType,
        assetCategory: this.assetCategory,
        dexName: this.dexName,
      },
      this,
    );
  }

  onModuleDestroy() {
    this.registry.remove({
      blockchain: this.blockchain,
      assetType: this.assetType,
      assetCategory: this.assetCategory,
      dexName: this.dexName,
    });
  }

  async feeAsset(): Promise<Asset> {
    return (this._feeAsset ??= await this.getFeeAsset());
  }

  async swapAssets(): Promise<Asset[]> {
    return (this.prioritySwapAssets ??= await this.getSwapAssets());
  }

  abstract get blockchain(): Blockchain;
  abstract get assetType(): AssetType;
  abstract get assetCategory(): AssetCategory;
  abstract get dexName(): string;

  abstract purchaseLiquidity(request: PurchaseLiquidityRequest): Promise<void>;
  abstract addPurchaseData(order: LiquidityOrder): Promise<void>;
  protected abstract getFeeAsset(): Promise<Asset>;

  // --- SWAP ASSETS --- //
  private async getSwapAssets(): Promise<Asset[]> {
    const prioritySwapAssets = [];

    for (const descriptor of this.swapAssetDescriptors) {
      try {
        const prioritySwapAsset = await this.getSwapAsset(descriptor);
        if (prioritySwapAsset) prioritySwapAssets.push(prioritySwapAsset);
      } catch {}
    }

    return prioritySwapAssets;
  }

  private async getSwapAsset({ name, type }: { name: string; type: AssetType }): Promise<Asset> {
    const asset = await this.assetService.getAssetByQuery({ dexName: name, type, blockchain: this.blockchain });
    if (!asset)
      throw new Error(`Swap Asset reference not found (name: ${name}, type: ${type}, blockchain: ${this.blockchain})`);

    return asset;
  }

  // --- ERROR HANDLING --- //
  protected async handlePurchaseLiquidityError(e: Error, request: PurchaseLiquidityRequest): Promise<void> {
    const errorMessage = `Correlation ID: ${request.correlationId}. Context: ${request.context}. ${e.message}`;

    if (e instanceof NotEnoughLiquidityException) {
      const mailRequest = this.createMailRequest(request, errorMessage);

      await this.notificationService.sendMail(mailRequest);
      throw new NotEnoughLiquidityException(errorMessage);
    }

    if (e instanceof PriceSlippageException) {
      throw new PriceSlippageException(errorMessage);
    }

    throw new Error(errorMessage);
  }

  private createMailRequest(liquidityRequest: PurchaseLiquidityRequest, errorMessage: string): MailRequest {
    const correlationId = `PurchaseLiquidity&${liquidityRequest.context}&${liquidityRequest.correlationId}`;

    return {
      type: MailType.ERROR_MONITORING,
      input: { subject: 'Purchase Liquidity Error', errors: [errorMessage] },
      metadata: {
        context: MailContext.DEX,
        correlationId,
      },
      options: { suppressRecurring: true },
    };
  }
}
