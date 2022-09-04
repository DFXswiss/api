import { DexEVMService } from '../../../services/dex-evm.service';
import { LiquidityRequest } from '../../../services/dex.service';
import { CheckLiquidityStrategy } from './check-liquidity.strategy';

export class CheckLiquidityEVMStrategy implements CheckLiquidityStrategy {
  constructor(protected readonly dexEVMService: DexEVMService) {}

  async checkLiquidity(request: LiquidityRequest): Promise<number> {
    const targetAmount = request.referenceAmount;

    await this.dexEVMService.checkCoinAvailability(targetAmount);

    return targetAmount;
  }
}
