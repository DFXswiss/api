import { Injectable } from '@nestjs/common';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutEthereumService } from '../../../services/payout-ethereum.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class EthereumTokenStrategy extends EvmStrategy {
  constructor(ethereumService: PayoutEthereumService, payoutOrderRepo: PayoutOrderRepository) {
    super(ethereumService, payoutOrderRepo);
  }
}
