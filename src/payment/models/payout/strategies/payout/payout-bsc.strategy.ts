import { Injectable } from '@nestjs/common';
import { PayoutOrderRepository } from '../../repositories/payout-order.repository';
import { PayoutBSCService } from '../../services/payout-bsc.service';
import { PayoutEVMStrategy } from './base/payout-evm.strategy';

@Injectable()
export class PayoutBSCStrategy extends PayoutEVMStrategy {
  constructor(bscService: PayoutBSCService, payoutOrderRepo: PayoutOrderRepository) {
    super(bscService, payoutOrderRepo);
  }
}
