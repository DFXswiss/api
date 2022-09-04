import { Injectable } from '@nestjs/common';
import { PayoutOrderRepository } from '../../repositories/payout-order.repository';
import { PayoutEthereumService } from '../../services/payout-ethereum.service';
import { PayoutEVMStrategy } from './base/payout-evm.strategy';

@Injectable()
export class PayoutEthereumStrategy extends PayoutEVMStrategy {
  constructor(ethereumService: PayoutEthereumService, payoutOrderRepo: PayoutOrderRepository) {
    super(ethereumService, payoutOrderRepo);
  }
}
