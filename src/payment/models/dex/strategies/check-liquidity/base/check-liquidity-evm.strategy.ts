import { LiquidityRequest } from '../../../interfaces';
import { DexEvmService } from '../../../services/dex-evm.service';
import { CheckLiquidityStrategy } from './check-liquidity.strategy';

export class CheckLiquidityEvmStrategy implements CheckLiquidityStrategy {
  constructor(protected readonly dexEvmService: DexEvmService) {}

  async checkLiquidity(request: LiquidityRequest): Promise<number> {
    const targetAmount = request.referenceAmount;

    await this.dexEvmService.checkCoinAvailability(targetAmount);

    return targetAmount;
  }
}
