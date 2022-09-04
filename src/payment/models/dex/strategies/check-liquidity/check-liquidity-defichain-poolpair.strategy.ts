import { Injectable } from '@nestjs/common';
import { CheckLiquidityStrategy } from './base/check-liquidity.strategy';

@Injectable()
export class CheckLiquidityDeFiChainPoolPairStrategy implements CheckLiquidityStrategy {
  // assume there is no poolpair liquidity available on DEX node
  async checkLiquidity(): Promise<number> {
    return 0;
  }
}
