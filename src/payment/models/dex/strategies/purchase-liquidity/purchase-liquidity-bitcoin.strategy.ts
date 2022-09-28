import { Injectable } from '@nestjs/common';
import { PurchaseLiquidityStrategy } from './base/purchase-liquidity.strategy';
import { LiquidityRequest } from '../../interfaces';

@Injectable()
export class PurchaseLiquidityBitcoinStrategy extends PurchaseLiquidityStrategy {
  async purchaseLiquidity(request: LiquidityRequest): Promise<void> {
    return;
  }
}
