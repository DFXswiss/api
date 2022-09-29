import { Injectable } from '@nestjs/common';
import { DexBscService } from '../../../services/dex-bsc.service';
import { EvmCryptoStrategy } from './base/evm-crypto.strategy';

@Injectable()
export class BscCryptoStrategy extends EvmCryptoStrategy {
  constructor(dexBscService: DexBscService) {
    super(dexBscService);
  }
}
