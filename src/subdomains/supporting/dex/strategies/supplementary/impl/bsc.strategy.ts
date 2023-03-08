import { Injectable } from '@nestjs/common';
import { DexBscService } from '../../../services/dex-bsc.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class BscStrategy extends EvmStrategy {
  constructor(bscService: DexBscService) {
    super(bscService);
  }
}
