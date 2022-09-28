import { Injectable } from '@nestjs/common';
import { PayoutOrderRepository } from '../../repositories/payout-order.repository';
import { PayoutEthereumService } from '../../services/payout-ethereum.service';
import { PayoutEvmStrategy } from './base/payout-evm.strategy';

@Injectable()
export class PayoutEthereumTokenStrategy extends PayoutEvmStrategy {
  constructor(ethereumService: PayoutEthereumService, payoutOrderRepo: PayoutOrderRepository) {
    super(ethereumService, payoutOrderRepo);
  }
}
