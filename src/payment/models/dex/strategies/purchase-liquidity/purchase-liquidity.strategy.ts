import { LiquidityOrder } from '../../entities/liquidity-order.entity';

export interface PurchaseLiquidityStrategy {
  purchaseLiquidity(order: LiquidityOrder): Promise<void>;
}
