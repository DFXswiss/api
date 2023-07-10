import { LiquidityOrder } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { CheckLiquidityRequest, CheckLiquidityResult } from '../../../../interfaces';
import { DexEvmService } from '../../../../services/base/dex-evm.service';
import { CheckLiquidityUtil } from '../../utils/check-liquidity.util';
import { CheckLiquidityStrategy } from './check-liquidity.strategy';

export abstract class EvmCoinStrategy extends CheckLiquidityStrategy {
  constructor(protected readonly dexEvmService: DexEvmService) {
    super();
  }

  async checkLiquidity(request: CheckLiquidityRequest): Promise<CheckLiquidityResult> {
    const { referenceAsset, referenceAmount, context, correlationId, targetAsset } = request;

    if (referenceAsset.dexName === this.dexEvmService._nativeCoin) {
      const { targetAmount, availableAmount } = await this.dexEvmService.getAndCheckAvailableTargetLiquidity(
        referenceAsset,
        referenceAmount,
        targetAsset,
        LiquidityOrder.getMaxPriceSlippage(targetAsset.dexName),
        [],
      );

      return CheckLiquidityUtil.createNonPurchasableCheckLiquidityResult(
        request,
        targetAmount,
        availableAmount,
        await this.feeAsset(),
      );
    }

    // only native coin is enabled as a referenceAsset
    throw new Error(
      `Only native coin reference is supported by EVM CheckLiquidity strategy. Provided reference asset: ${referenceAsset.dexName} Context: ${context}. CorrelationID: ${correlationId}`,
    );
  }
}
