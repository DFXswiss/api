import { LiquidityRequest } from '../../../../interfaces';
import { DexEvmService } from '../../../../services/dex-evm.service';
import { CheckLiquidityStrategy } from './check-liquidity.strategy';

export class EvmTokenStrategy implements CheckLiquidityStrategy {
  constructor(protected readonly dexEvmService: DexEvmService) {}

  async checkLiquidity(request: LiquidityRequest): Promise<number> {
    const { referenceAmount, referenceAsset, targetAsset } = request;

    return this.dexEvmService.getAndCheckTokenAvailability(referenceAsset, referenceAmount, targetAsset);
  }
}
