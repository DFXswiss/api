import { Injectable } from '@nestjs/common';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';

@Injectable()
export class PurchasePoolPairLiquidityStrategy implements PurchaseLiquidityStrategy {
  purchaseLiquidity(): Promise<void> {
    throw new Error('Method not implemented.');
  }
}
