import { LiquidityRequest } from '../../../services/dex.service';
import { CheckLiquidityStrategy } from './check-liquidity.strategy';

export class CheckETHBaseLiquidityStrategy implements CheckLiquidityStrategy {
  constructor(private readonly dexEthereumService: any) {}

  async checkLiquidity(request: LiquidityRequest): Promise<number> {
    const targetAmount = request.referenceAmount;

    await this.dexEthereumService.checkETHAvailability(targetAmount);

    return targetAmount;
  }
}
