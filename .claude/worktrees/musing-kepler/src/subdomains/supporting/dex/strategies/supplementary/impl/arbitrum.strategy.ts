import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DexArbitrumService } from '../../../services/dex-arbitrum.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class ArbitrumStrategy extends EvmStrategy {
  constructor(arbitrumService: DexArbitrumService) {
    super(arbitrumService);
  }

  get blockchain(): Blockchain {
    return Blockchain.ARBITRUM;
  }
}
