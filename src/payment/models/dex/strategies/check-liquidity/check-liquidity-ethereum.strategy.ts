import { Injectable } from '@nestjs/common';
import { DexEthereumService } from '../../services/dex-ethereum.service';
import { CheckLiquidityEvmStrategy } from './base/check-liquidity-evm.strategy';

@Injectable()
export class CheckLiquidityEthereumStrategy extends CheckLiquidityEvmStrategy {
  constructor(dexEthereumService: DexEthereumService) {
    super(dexEthereumService);
  }
}
