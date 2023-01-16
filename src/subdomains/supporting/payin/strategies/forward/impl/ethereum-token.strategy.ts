import { Injectable } from '@nestjs/common';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInEthereumService } from '../../../services/payin-ethereum.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class EthereumTokenStrategy extends EvmStrategy {
  constructor(protected readonly ethereumService: PayInEthereumService, payInRepo: PayInRepository) {
    super(ethereumService, payInRepo);
  }
}
