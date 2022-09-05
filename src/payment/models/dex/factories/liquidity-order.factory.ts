import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { AssetCategory } from 'src/shared/models/asset/asset.entity';
import { LiquidityOrder, LiquidityOrderType } from '../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { LiquidityRequest } from '../services/dex.service';

@Injectable()
export class LiquidityOrderFactory {
  constructor(private readonly liquidityOrderRepo: LiquidityOrderRepository) {}

  // *** PUBLIC API *** //

  createPurchaseOrder(
    request: LiquidityRequest,
    chain: Blockchain,
    purchaseAssetCategory: AssetCategory,
  ): LiquidityOrder {
    const order = this.createOrder(request, chain, LiquidityOrderType.PURCHASE);
    order.purchaseStrategy = purchaseAssetCategory;

    return order;
  }

  createReservationOrder(request: LiquidityRequest, chain: Blockchain): LiquidityOrder {
    return this.createOrder(request, chain, LiquidityOrderType.RESERVATION);
  }

  // *** HELPER METHODS *** //

  private createOrder(request: LiquidityRequest, chain: Blockchain, type: LiquidityOrderType): LiquidityOrder {
    const { context, correlationId, referenceAsset, referenceAmount, targetAsset } = request;

    return this.liquidityOrderRepo.create({
      type,
      context,
      correlationId,
      chain,
      referenceAsset,
      referenceAmount,
      targetAsset,
    });
  }
}
