import { Injectable } from '@nestjs/common';
import { LiquidityRequest } from '../../../interfaces';
import { DexBitcoinService } from '../../../services/dex-bitcoin.service';
import { CheckLiquidityStrategy } from './base/check-liquidity.strategy';

@Injectable()
export class BitcoinStrategy implements CheckLiquidityStrategy {
  constructor(private readonly dexBtcService: DexBitcoinService) {}

  async checkLiquidity(request: LiquidityRequest): Promise<number> {
    return 0;
  }
}
