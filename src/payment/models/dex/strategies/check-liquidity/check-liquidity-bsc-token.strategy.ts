import { Injectable } from '@nestjs/common';
import { DexBscService } from '../../services/dex-bsc.service';
import { CheckLiquidityEvmTokenStrategy } from './base/check-liquidity-evm-token.strategy';

@Injectable()
export class CheckLiquidityBscTokenStrategy extends CheckLiquidityEvmTokenStrategy {
  constructor(dexBscService: DexBscService) {
    super(dexBscService);
  }
}
