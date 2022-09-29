import { Injectable } from '@nestjs/common';
import { DexBscService } from '../../../services/dex-bsc.service';
import { EvmTokenStrategy } from './base/evm-token.strategy';

@Injectable()
export class BscTokenStrategy extends EvmTokenStrategy {
  constructor(dexBscService: DexBscService) {
    super(dexBscService);
  }
}
