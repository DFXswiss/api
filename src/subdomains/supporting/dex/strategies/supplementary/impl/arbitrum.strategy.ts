import { Injectable } from '@nestjs/common';
import { DexArbitrumService } from '../../../services/dex-arbitrum.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class ArbitrumStrategy extends EvmStrategy {
  constructor(arbitrumService: DexArbitrumService) {
    super(arbitrumService);
  }
}
