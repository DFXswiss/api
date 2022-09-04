import { Injectable } from '@nestjs/common';
import { DexBSCService } from '../../services/dex-bsc.service';
import { CheckETHBaseLiquidityStrategy } from './base/check-liquidity-evm.strategy';

@Injectable()
export class CheckBSCLiquidityStrategy extends CheckETHBaseLiquidityStrategy {
  constructor(dexBscService: DexBSCService) {
    super(dexBscService);
  }
}
