import { Injectable } from '@nestjs/common';
import { AssetCategory } from 'src/shared/models/asset/asset.entity';
import { LiquidityOrder, LiquidityOrderType } from '../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { LiquidityRequest } from '../services/dex.service';

@Injectable()
export class LiquidityOrderFactory {
  constructor(private readonly liquidityOrderRepo: LiquidityOrderRepository) {}

  // *** PUBLIC API *** //

  createPurchaseOrder(request: LiquidityRequest, chain: string, purchaseStrategy: AssetCategory): LiquidityOrder {
    const order = this.createOrder(request, chain, LiquidityOrderType.PURCHASE);
    order.purchaseStrategy = purchaseStrategy;

    return order;
  }

  createReservationOrder(request: LiquidityRequest, chain: string): LiquidityOrder {
    return this.createOrder(request, chain, LiquidityOrderType.RESERVATION);
  }

  // *** HELPER METHODS *** //

  private createOrder(request: LiquidityRequest, chain: string, type: LiquidityOrderType): LiquidityOrder {
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
