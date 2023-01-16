import { Injectable } from '@nestjs/common';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInDeFiChainService } from '../../../services/payin-defichain.service';
import { ReturnStrategy } from './base/return.strategy';

@Injectable()
export class DeFiChainTokenStrategy extends ReturnStrategy {
  constructor(protected readonly bitcoinService: PayInDeFiChainService, payInRepo: PayInRepository) {
    super();
  }
}
