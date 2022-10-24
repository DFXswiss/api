import { CheckLiquidityResult, LiquidityRequest } from '../../../../interfaces';
import { DexEvmService } from '../../../../services/dex-evm.service';
import { CheckLiquidityStrategy } from './check-liquidity.strategy';

export abstract class EvmCoinStrategy extends CheckLiquidityStrategy {
  constructor(protected readonly dexEvmService: DexEvmService) {
    super();
  }

  async checkLiquidity(request: LiquidityRequest): Promise<CheckLiquidityResult> {
    const { referenceAsset, referenceAmount, context, correlationId } = request;

    if (referenceAsset === this.dexEvmService._nativeCoin) {
      return this.dexEvmService.checkNativeCoinAvailability(referenceAmount);
    }

    // only native coin is enabled as a referenceAsset
    throw new Error(
      `Only native coin reference is supported by EVM CheckLiquidity strategy. Provided reference asset: ${referenceAsset} Context: ${context}. CorrelationID: ${correlationId}`,
    );
  }
}
