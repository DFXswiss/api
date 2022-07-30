import { Injectable } from '@nestjs/common';
import { LiquidityOrder } from '../../entities/liquidity-order.entity';
import { LiquidityRequest } from '../../services/dex.service';
import { LiquidityService } from '../../services/liquidity.service';
import { CheckLiquidityStrategy } from './check-liquidity.strategy';

@Injectable()
export class CheckLiquidityDefaultStrategy implements CheckLiquidityStrategy {
  constructor(private readonly liquidityService: LiquidityService) {}

  async checkLiquidity(request: LiquidityRequest): Promise<number> {
    const { referenceAsset, referenceAmount, targetAsset } = request;

    // calculating how much targetAmount is needed and if it's available on the node
    return this.liquidityService.getAndCheckAvailableTargetLiquidity(
      referenceAsset,
      referenceAmount,
      targetAsset.dexName,
      LiquidityOrder.getMaxPriceSlippage(targetAsset.dexName),
    );
  }
}
