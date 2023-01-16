import { Injectable } from '@nestjs/common';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInArbitrumService } from '../../../services/payin-arbitrum.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class ArbitrumCoinStrategy extends EvmStrategy {
  constructor(protected readonly arbitrumService: PayInArbitrumService, payInRepo: PayInRepository) {
    super(arbitrumService, payInRepo);
  }
}
