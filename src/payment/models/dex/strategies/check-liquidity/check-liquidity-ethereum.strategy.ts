import { Injectable } from '@nestjs/common';
import { DexEthereumService } from '../../services/dex-ethereum.service';
import { CheckLiquidityStrategy } from './check-liquidity.strategy';

@Injectable()
export class CheckEthereumLiquidityStrategy implements CheckLiquidityStrategy {
  constructor(private readonly dexEthereumService: DexEthereumService) {}

  async checkLiquidity(): Promise<number> {
    return this.dexEthereumService.getBalance();
  }
}
