import { Injectable } from '@nestjs/common';
import { DexEthereumService } from '../../services/dex-ethereum.service';
import { CheckETHBaseLiquidityStrategy } from './base/check-liquidity-evm.strategy';

@Injectable()
export class CheckETHLiquidityStrategy extends CheckETHBaseLiquidityStrategy {
  constructor(dexEthereumService: DexEthereumService) {
    super(dexEthereumService);
  }
}
