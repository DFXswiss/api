import { Injectable } from '@nestjs/common';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInBscService } from '../../../services/payin-bsc.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class BscCoinStrategy extends EvmStrategy {
  constructor(protected readonly bscService: PayInBscService, payInRepo: PayInRepository) {
    super(bscService, payInRepo);
  }
}
