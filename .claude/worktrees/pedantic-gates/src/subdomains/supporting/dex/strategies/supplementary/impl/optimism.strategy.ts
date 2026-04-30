import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DexOptimismService } from '../../../services/dex-optimism.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class OptimismStrategy extends EvmStrategy {
  constructor(optimismService: DexOptimismService) {
    super(optimismService);
  }

  get blockchain(): Blockchain {
    return Blockchain.OPTIMISM;
  }
}
