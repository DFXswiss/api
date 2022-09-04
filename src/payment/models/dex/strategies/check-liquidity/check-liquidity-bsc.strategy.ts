import { Injectable } from '@nestjs/common';
import { DexBSCService } from '../../services/dex-bsc.service';
import { CheckLiquidityEVMStrategy } from './base/check-liquidity-evm.strategy';

@Injectable()
export class CheckLiquidityBSCStrategy extends CheckLiquidityEVMStrategy {
  constructor(dexBscService: DexBSCService) {
    super(dexBscService);
  }
}
