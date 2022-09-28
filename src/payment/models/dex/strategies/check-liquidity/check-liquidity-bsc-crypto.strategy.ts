import { Injectable } from '@nestjs/common';
import { DexBscService } from '../../services/dex-bsc.service';
import { CheckLiquidityEvmCryptoStrategy } from './base/check-liquidity-evm-crypto.strategy';

@Injectable()
export class CheckLiquidityBscCryptoStrategy extends CheckLiquidityEvmCryptoStrategy {
  constructor(dexBscService: DexBscService) {
    super(dexBscService);
  }
}
