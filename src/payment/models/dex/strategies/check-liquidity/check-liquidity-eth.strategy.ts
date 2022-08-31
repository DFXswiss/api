import { Injectable } from '@nestjs/common';
import { DexEthereumService } from '../../services/dex-ethereum.service';
import { CheckETHBaseLiquidityStrategy } from './check-liquidity-eth-base.strategy';

@Injectable()
export class CheckETHLiquidityStrategy extends CheckETHBaseLiquidityStrategy {
  constructor(dexEthereumService: DexEthereumService) {
    super(dexEthereumService);
  }
}
