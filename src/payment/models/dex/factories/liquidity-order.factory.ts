import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { LiquidityRequest } from '../services/dex.service';

@Injectable()
export class LiquidityOrderFactory {
  constructor(private readonly liquidityOrderRepo: LiquidityOrderRepository) {}

  createFromRequest(request: LiquidityRequest, chain: string): LiquidityOrder {
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

  createFromParentOrder(targetAsset: Asset, order: LiquidityOrder, chain: string): LiquidityOrder {
    const { context, correlationId, referenceAsset, referenceAmount } = order;

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
