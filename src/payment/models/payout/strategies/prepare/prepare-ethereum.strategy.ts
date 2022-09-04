import { Injectable } from '@nestjs/common';
import { PayoutOrderRepository } from '../../repositories/payout-order.repository';
import { PrepareEVMStrategy } from './base/prepare-evm.strategy';

@Injectable()
export class PrepareEthereumStrategy extends PrepareEVMStrategy {
  constructor(payoutOrderRepo: PayoutOrderRepository) {
    super(payoutOrderRepo);
  }
}
