import { CheckLiquidityResult, LiquidityRequest } from '../../../../interfaces';
import { DexEvmService } from '../../../../services/dex-evm.service';
import { CheckLiquidityUtil } from '../../utils/check-liquidity.util';
import { CheckLiquidityStrategy } from './check-liquidity.strategy';

export abstract class EvmTokenStrategy extends CheckLiquidityStrategy {
  constructor(protected readonly dexEvmService: DexEvmService) {
    super();
  }

  async checkLiquidity(request: LiquidityRequest): Promise<CheckLiquidityResult> {
    const { referenceAmount, referenceAsset, targetAsset } = request;

    const [targetAmount, availableAmount] = await this.dexEvmService.getAndCheckTokenAvailability(
      referenceAsset.dexName,
      referenceAmount,
      targetAsset,
    );

    // will be different from coin implementation once token auto-purchase implemented.
    return CheckLiquidityUtil.createNonPurchasableCheckLiquidityResult(
      request,
      targetAmount,
      availableAmount,
      await this.feeAsset(),
    );
  }
}
