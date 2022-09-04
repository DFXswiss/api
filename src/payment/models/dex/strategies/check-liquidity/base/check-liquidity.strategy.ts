import { LiquidityRequest } from '../../../services/dex.service';

export interface CheckLiquidityStrategy {
  checkLiquidity(request: LiquidityRequest): Promise<number>;
}
