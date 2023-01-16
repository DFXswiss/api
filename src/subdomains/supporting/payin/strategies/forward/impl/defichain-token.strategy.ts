import { Injectable } from '@nestjs/common';
import { PayInDeFiChainService } from '../../../services/payin-defichain.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { ForwardStrategy } from './base/forward.strategy';

@Injectable()
export class DeFiChainTokenStrategy extends ForwardStrategy {
  constructor(protected readonly bitcoinService: PayInDeFiChainService, payInRepo: PayInRepository) {
    super();
  }
}
