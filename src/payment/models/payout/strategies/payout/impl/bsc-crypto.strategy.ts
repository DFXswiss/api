import { Injectable } from '@nestjs/common';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutBscService } from '../../../services/payout-bsc.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class BscCryptoStrategy extends EvmStrategy {
  constructor(bscService: PayoutBscService, payoutOrderRepo: PayoutOrderRepository) {
    super(bscService, payoutOrderRepo);
  }
}
