import { Injectable } from '@nestjs/common';
import { BSCClient } from 'src/blockchain/bsc/bsc-client';
import { DexBSCService } from '../../services/dex-bsc.service';
import { CheckLiquidityEVMStrategy } from './base/check-liquidity-evm.strategy';

@Injectable()
export class CheckLiquidityBSCStrategy extends CheckLiquidityEVMStrategy<BSCClient> {
  constructor(dexBscService: DexBSCService) {
    super(dexBscService);
  }
}
