import { LiquidityRequest } from '../../../../interfaces';
import { DexEvmService } from '../../../../services/dex-evm.service';
import { CheckLiquidityStrategy } from './check-liquidity.strategy';

export class EvmTokenStrategy implements CheckLiquidityStrategy {
  constructor(protected readonly dexEvmService: DexEvmService) {}

  async checkLiquidity(request: LiquidityRequest): Promise<number> {
    return 0;
  }
}
