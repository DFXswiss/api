import { Injectable } from '@nestjs/common';
import { DexEthereumService } from '../../services/dex-ethereum.service';
import { CheckLiquidityEvmTokenStrategy } from './base/check-liquidity-evm-token.strategy';

@Injectable()
export class CheckLiquidityEthereumTokenStrategy extends CheckLiquidityEvmTokenStrategy {
  constructor(dexEthereumService: DexEthereumService) {
    super(dexEthereumService);
  }
}
