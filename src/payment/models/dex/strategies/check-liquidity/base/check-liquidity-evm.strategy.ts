import { LiquidityRequest } from '../../../interfaces';
import { DexEVMService } from '../../../services/dex-evm.service';
import { CheckLiquidityStrategy } from './check-liquidity.strategy';

export class CheckLiquidityEVMStrategy implements CheckLiquidityStrategy {
  constructor(protected readonly dexEVMService: DexEVMService) {}

  async checkLiquidity(request: LiquidityRequest): Promise<number> {
    const targetAmount = request.referenceAmount;

    await this.dexEVMService.checkCoinAvailability(targetAmount);

    return targetAmount;
  }
}
