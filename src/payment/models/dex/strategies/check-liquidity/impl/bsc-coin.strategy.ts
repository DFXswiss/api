import { Injectable } from '@nestjs/common';
import { DexBscService } from '../../../services/dex-bsc.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class BscCoinStrategy extends EvmCoinStrategy {
  constructor(dexBscService: DexBscService) {
    super(dexBscService);
  }
}
