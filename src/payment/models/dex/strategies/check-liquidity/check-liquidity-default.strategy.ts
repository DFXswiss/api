import { Injectable } from '@nestjs/common';
import { LiquidityOrder } from '../../entities/liquidity-order.entity';
import { LiquidityRequest } from '../../services/dex.service';
import { DexDeFiChainService } from '../../services/dex-defichain.service';
import { CheckLiquidityStrategy } from './check-liquidity.strategy';

@Injectable()
export class CheckLiquidityDefaultStrategy implements CheckLiquidityStrategy {
  constructor(private readonly dexDeFiChainService: DexDeFiChainService) {}

  async checkLiquidity(request: LiquidityRequest): Promise<number> {
    const { referenceAsset, referenceAmount, targetAsset } = request;

    // calculating how much targetAmount is needed and if it's available on the node
    return this.dexDeFiChainService.getAndCheckAvailableTargetLiquidity(
      referenceAsset,
      referenceAmount,
      targetAsset.dexName,
      LiquidityOrder.getMaxPriceSlippage(targetAsset.dexName),
    );
  }
}
