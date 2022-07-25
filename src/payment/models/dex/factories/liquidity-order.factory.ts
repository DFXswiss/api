import { Injectable } from '@nestjs/common';
import { AssetCategory } from 'src/shared/models/asset/asset.entity';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { LiquidityRequest } from '../services/dex.service';

@Injectable()
export class LiquidityOrderFactory {
  constructor(private readonly liquidityOrderRepo: LiquidityOrderRepository) {}

  createFromRequest(request: LiquidityRequest, chain: string, strategy: AssetCategory): LiquidityOrder {
    const { context, correlationId, referenceAsset, referenceAmount, targetAsset } = request;

    return this.liquidityOrderRepo.create({
      context,
      correlationId,
      strategy,
      chain,
      referenceAsset,
      referenceAmount,
      targetAsset,
    });
  }
}
