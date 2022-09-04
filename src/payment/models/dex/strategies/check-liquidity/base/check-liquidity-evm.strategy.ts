import { EVMClient } from 'src/blockchain/shared/evm/evm-client';
import { DexEVMService } from '../../../services/dex-evm.service';
import { LiquidityRequest } from '../../../services/dex.service';
import { CheckLiquidityStrategy } from './check-liquidity.strategy';

export class CheckLiquidityEVMStrategy<T extends EVMClient> implements CheckLiquidityStrategy {
  constructor(private readonly dexEVMService: DexEVMService<T>) {}

  async checkLiquidity(request: LiquidityRequest): Promise<number> {
    const targetAmount = request.referenceAmount;

    await this.dexEVMService.checkCoinAvailability(targetAmount);

    return targetAmount;
  }
}
