import { Injectable } from '@nestjs/common';
import { DexEthereumService } from '../../services/dex-ethereum.service';
import { CheckLiquidityEvmCryptoStrategy } from './base/check-liquidity-evm-crypto.strategy';

@Injectable()
export class CheckLiquidityEthereumCryptoStrategy extends CheckLiquidityEvmCryptoStrategy {
  constructor(dexEthereumService: DexEthereumService) {
    super(dexEthereumService);
  }
}
