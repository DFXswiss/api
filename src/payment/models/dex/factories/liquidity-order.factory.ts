import { Injectable } from '@nestjs/common';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { PurchaseLiquidityRequest } from '../strategies/purchase-liquidity/purchase-liquidity.strategy';

@Injectable()
export class LiquidityOrderFactory {
  constructor(private readonly liquidityOrderRepo: LiquidityOrderRepository) {}

  createFromPurchaseLiquidityRequest(request: PurchaseLiquidityRequest, chain: string): LiquidityOrder {
    const { context, correlationId, referenceAsset, referenceAmount, targetAsset } = request;

    return this.liquidityOrderRepo.create({
      context,
      correlationId,
      chain,
      referenceAsset,
      referenceAmount,
      targetAsset,
    });
  }
}
