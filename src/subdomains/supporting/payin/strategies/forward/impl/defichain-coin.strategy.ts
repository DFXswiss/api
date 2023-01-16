import { Injectable } from '@nestjs/common';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInDeFiChainService } from '../../../services/payin-defichain.service';
import { ForwardStrategy } from './base/forward.strategy';

@Injectable()
export class DeFiChainCoinStrategy extends ForwardStrategy {
  constructor(protected readonly bitcoinService: PayInDeFiChainService, payInRepo: PayInRepository) {
    super();
  }
}
