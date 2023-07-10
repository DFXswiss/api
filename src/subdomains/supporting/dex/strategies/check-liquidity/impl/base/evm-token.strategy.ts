import { LiquidityOrder } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { DexEvmService } from 'src/subdomains/supporting/dex/services/base/dex-evm.service';
import { CheckLiquidityRequest, CheckLiquidityResult } from '../../../../interfaces';
import { CheckLiquidityUtil } from '../../utils/check-liquidity.util';
import { CheckLiquidityStrategy } from './check-liquidity.strategy';

export abstract class EvmTokenStrategy extends CheckLiquidityStrategy {
  constructor(protected readonly dexEvmService: DexEvmService) {
    super();
  }

  async checkLiquidity(request: CheckLiquidityRequest): Promise<CheckLiquidityResult> {
    const { referenceAmount, referenceAsset, targetAsset } = request;

    const prioritySwapAssets = await this.getPrioritySwapAssets(targetAsset);

    const liquidity = await this.dexEvmService.getAndCheckAvailableTargetLiquidity(
      referenceAsset,
      referenceAmount,
      targetAsset,
      LiquidityOrder.getMaxPriceSlippage(targetAsset.dexName),
      prioritySwapAssets,
    );

    return CheckLiquidityUtil.createCheckLiquidityResult(request, liquidity, await this.feeAsset());
  }
}
