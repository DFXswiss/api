import { LiquidityRequest } from '../../../../interfaces';

export interface CheckLiquidityStrategy {
  checkLiquidity(request: LiquidityRequest): Promise<number>;
}
