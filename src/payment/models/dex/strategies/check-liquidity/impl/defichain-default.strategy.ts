import { Injectable } from '@nestjs/common';
import { LiquidityOrder } from '../../../entities/liquidity-order.entity';
import { LiquidityRequest } from '../../../interfaces';
import { DexDeFiChainService } from '../../../services/dex-defichain.service';
import { CheckLiquidityStrategy } from './base/check-liquidity.strategy';

@Injectable()
export class DeFiChainDefaultStrategy implements CheckLiquidityStrategy {
  constructor(private readonly dexDeFiChainService: DexDeFiChainService) {}

  async checkLiquidity(request: LiquidityRequest): Promise<number> {
    const { referenceAsset, referenceAmount, targetAsset, options } = request;

    // calculating how much targetAmount is needed and if it's available on the node
    return this.dexDeFiChainService.getAndCheckAvailableTargetLiquidity(
      referenceAsset,
      referenceAmount,
      targetAsset.dexName,
      LiquidityOrder.getMaxPriceSlippage(targetAsset.dexName),
      options?.bypassAvailabilityCheck,
      options?.bypassSlippageProtection,
    );
  }
}
