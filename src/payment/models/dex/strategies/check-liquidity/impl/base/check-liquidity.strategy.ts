import { CheckLiquidityResult, LiquidityRequest } from '../../../../interfaces';

export interface CheckLiquidityStrategy {
  checkLiquidity(request: LiquidityRequest): Promise<CheckLiquidityResult>;
}
