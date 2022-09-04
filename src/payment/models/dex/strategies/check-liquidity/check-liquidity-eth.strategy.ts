import { Injectable } from '@nestjs/common';
import { DexEthereumService } from '../../services/dex-ethereum.service';
import { CheckLiquidityEVMStrategy } from './base/check-liquidity-evm.strategy';

@Injectable()
export class CheckLiquidityETHStrategy extends CheckLiquidityEVMStrategy {
  constructor(dexEthereumService: DexEthereumService) {
    super(dexEthereumService);
  }
}
