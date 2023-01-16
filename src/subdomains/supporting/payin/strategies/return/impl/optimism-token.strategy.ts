import { Injectable } from '@nestjs/common';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInOptimismService } from '../../../services/payin-optimism.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class OptimismTokenStrategy extends EvmStrategy {
  constructor(protected readonly optimismService: PayInOptimismService, payInRepo: PayInRepository) {
    super(optimismService, payInRepo);
  }
}
