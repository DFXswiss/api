import { CheckLiquidityStrategy } from './check-liquidity.strategy';

export class CheckPoolPairLiquidityStrategy implements CheckLiquidityStrategy {
  // assume there is no poolpair liquidity available on DEX node
  async checkLiquidity(): Promise<number> {
    return 0;
  }
}
