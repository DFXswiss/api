import { Injectable } from '@nestjs/common';
import { PayoutOrderRepository } from '../../repositories/payout-order.repository';
import { PrepareEvmStrategy } from './base/prepare-evm.strategy';

@Injectable()
export class PrepareEthereumStrategy extends PrepareEvmStrategy {
  constructor(payoutOrderRepo: PayoutOrderRepository) {
    super(payoutOrderRepo);
  }
}
