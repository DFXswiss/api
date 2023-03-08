import { Injectable } from '@nestjs/common';
import { DexOptimismService } from '../../../services/dex-optimism.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class OptimismStrategy extends EvmStrategy {
  constructor(optimismService: DexOptimismService) {
    super(optimismService);
  }
}
