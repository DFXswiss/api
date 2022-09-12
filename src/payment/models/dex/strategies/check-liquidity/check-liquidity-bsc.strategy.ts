import { Injectable } from '@nestjs/common';
import { DexBscService } from '../../services/dex-bsc.service';
import { CheckLiquidityEvmStrategy } from './base/check-liquidity-evm.strategy';

@Injectable()
export class CheckLiquidityBscStrategy extends CheckLiquidityEvmStrategy {
  constructor(dexBscService: DexBscService) {
    super(dexBscService);
  }
}
