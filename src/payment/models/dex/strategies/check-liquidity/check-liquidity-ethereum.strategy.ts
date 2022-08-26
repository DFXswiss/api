import { Injectable } from '@nestjs/common';
import { DexEthereumService } from '../../services/dex-ethereum.service';
import { LiquidityRequest } from '../../services/dex.service';
import { CheckLiquidityStrategy } from './check-liquidity.strategy';

@Injectable()
export class CheckEthereumLiquidityStrategy implements CheckLiquidityStrategy {
  constructor(private readonly dexEthereumService: DexEthereumService) {}

  async checkLiquidity(request: LiquidityRequest): Promise<number> {
    const targetAmount = request.referenceAmount;

    await this.dexEthereumService.checkETHAvailability(targetAmount);

    return targetAmount;
  }
}
