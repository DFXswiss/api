import { Injectable } from '@nestjs/common';
import { PayoutOrderRepository } from '../../repositories/payout-order.repository';
import { PayoutBscService } from '../../services/payout-bsc.service';
import { PayoutEvmStrategy } from './base/payout-evm.strategy';

@Injectable()
export class PayoutBscStrategy extends PayoutEvmStrategy {
  constructor(bscService: PayoutBscService, payoutOrderRepo: PayoutOrderRepository) {
    super(bscService, payoutOrderRepo);
  }
}
