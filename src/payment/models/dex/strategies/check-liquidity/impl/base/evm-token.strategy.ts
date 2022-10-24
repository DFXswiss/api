import { CheckLiquidityResult, LiquidityRequest } from '../../../../interfaces';
import { DexEvmService } from '../../../../services/dex-evm.service';
import { CheckLiquidityStrategy } from './check-liquidity.strategy';

export abstract class EvmTokenStrategy extends CheckLiquidityStrategy {
  constructor(protected readonly dexEvmService: DexEvmService) {
    super();
  }

  async checkLiquidity(request: LiquidityRequest): Promise<CheckLiquidityResult> {
    const { referenceAmount, referenceAsset, targetAsset } = request;

    return this.dexEvmService.getAndCheckTokenAvailability(referenceAsset, referenceAmount, targetAsset);
  }
}
